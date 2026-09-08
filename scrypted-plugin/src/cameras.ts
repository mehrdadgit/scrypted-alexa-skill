import type { Online, RTCSessionControl, RTCSignalingChannel, ScryptedDevice } from '@scrypted/sdk';
import { Directive, errorReply, reply } from '../../shared/alexa';
import { AlexaSignalingSession } from './signaling';

export type Camera = ScryptedDevice & RTCSignalingChannel & Partial<Online>;
interface Session {
  endpointId: string;
  offer: string;
  answer: Promise<string>;
  control?: RTCSessionControl;
  expired: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export class CameraBridge {
  private sessions = new Map<string, Session>();
  constructor(private readonly cameras: () => Camera[], private readonly setupTimeout = 5000, private readonly sessionLifetime = 10 * 60_000) {}

  private async close(id: string, session: Session) {
    session.expired = true;
    clearTimeout(session.timer);
    if (this.sessions.get(id) === session) this.sessions.delete(id);
    try { await session.control?.endSession(); } catch { /* best effort cleanup */ }
  }

  async handle(d: Directive) {
    const key = `${d.header.namespace}/${d.header.name}`;
    const cameras = this.cameras();
    if (key === 'Alexa.Discovery/Discover') return reply(d, 'Alexa.Discovery', 'Discover.Response', {
      endpoints: cameras.map(camera => ({
        endpointId: camera.id,
        manufacturerName: 'Scrypted',
        friendlyName: camera.name,
        description: 'Personal Scrypted camera',
        displayCategories: ['CAMERA'],
        cookie: {},
        capabilities: [
          { type: 'AlexaInterface', interface: 'Alexa', version: '3' },
          { type: 'AlexaInterface', interface: 'Alexa.RTCSessionController', version: '3', configuration: { isFullDuplexAudioSupported: false } },
          { type: 'AlexaInterface', interface: 'Alexa.EndpointHealth', version: '3.1', properties: { supported: [{ name: 'connectivity' }], proactivelyReported: false, retrievable: true } },
        ],
      })),
    });
    const camera = cameras.find(c => c.id === d.endpoint?.endpointId);
    if (!camera) return errorReply(d, 'NO_SUCH_ENDPOINT', 'This camera is not selected in Scrypted.');
    if (key === 'Alexa/ReportState') return {
      ...reply(d, 'Alexa', 'StateReport'),
      context: { properties: [{ namespace: 'Alexa.EndpointHealth', name: 'connectivity', value: { value: camera.online === false ? 'UNREACHABLE' : 'OK' }, timeOfSample: new Date().toISOString(), uncertaintyInMilliseconds: 0 }] },
    };
    if (!['Alexa.RTCSessionController/InitiateSessionWithOffer', 'Alexa.RTCSessionController/SessionConnected', 'Alexa.RTCSessionController/SessionDisconnected'].includes(key))
      return errorReply(d, 'INVALID_DIRECTIVE', 'Unsupported camera directive.');
    const sessionId = d.payload.sessionId;
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256)
      return errorReply(d, 'INVALID_DIRECTIVE', 'Missing or invalid session ID.');
    const existing = this.sessions.get(sessionId);
    if (existing && existing.endpointId !== camera.id)
      return errorReply(d, 'INVALID_DIRECTIVE', 'Session belongs to another camera.');
    if (key.endsWith('/SessionDisconnected')) {
      if (existing) await this.close(sessionId, existing);
      return reply(d, 'Alexa.RTCSessionController', 'SessionDisconnected', { sessionId });
    }
    if (key.endsWith('/SessionConnected'))
      return reply(d, 'Alexa.RTCSessionController', 'SessionConnected', { sessionId });
    if (camera.online === false) return errorReply(d, 'ENDPOINT_UNREACHABLE', 'Camera is offline.');
    const offer = d.payload.offer;
    if (offer?.format !== 'SDP' || typeof offer.value !== 'string' || !offer.value.startsWith('v=0') || offer.value.length > 128_000)
      return errorReply(d, 'INVALID_DIRECTIVE', 'A valid SDP offer is required.');
    if (existing && existing.offer !== offer.value)
      return errorReply(d, 'INVALID_DIRECTIVE', 'Session ID already used with a different offer.');
    if (!existing && this.sessions.size >= 8)
      return errorReply(d, 'ENDPOINT_BUSY', 'Too many camera sessions.');
    let session = existing;
    if (!session) {
      const signaling = new AlexaSignalingSession(offer.value);
      session = { endpointId: camera.id, offer: offer.value, expired: false, answer: signaling.answer };
      this.sessions.set(sessionId, session);
      const active = session;
      let setupTimer: ReturnType<typeof setTimeout>;
      // Start control creation alongside the answer: Scrypted may deliver the answer
      // before startRTCSignalingSession returns its control object.
      const started = Promise.resolve().then(() => camera.startRTCSignalingSession(signaling)).then(async control => {
        active.control = control;
        if (active.expired) { await control?.endSession(); return; }
        // No talkback advertised; disable audio/video sent from Alexa to the camera.
        await control?.setPlayback({ audio: false, video: false });
      });
      active.answer = Promise.race([
        signaling.answer,
        started.then(() => signaling.answer),
        new Promise<never>((_, reject) => { setupTimer = setTimeout(() => reject(new Error('RTC setup timeout')), this.setupTimeout); }),
      ]).finally(() => clearTimeout(setupTimer));
      // If startup fails after the SDP reply, release any remaining resources.
      void started.catch(() => this.close(sessionId, active));
      active.timer = setTimeout(() => { void this.close(sessionId, active); }, this.sessionLifetime);
      active.timer.unref?.();
    }
    try {
      const answer = await session.answer;
      if (session.expired) throw new Error('Session ended');
      return reply(d, 'Alexa.RTCSessionController', 'AnswerGeneratedForSession', { answer: { format: 'SDP', value: answer } });
    } catch {
      await this.close(sessionId, session);
      return errorReply(d, 'ENDPOINT_UNREACHABLE', 'Unable to start the camera WebRTC stream.');
    }
  }
}
