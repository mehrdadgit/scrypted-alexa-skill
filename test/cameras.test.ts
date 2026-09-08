import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera, CameraBridge } from '../scrypted-plugin/src/cameras';
import { Directive } from '../shared/alexa';

function request(name: string, endpointId = 'camera-1', sessionId = 'session-1'): Directive {
  return {
    header: { namespace: 'Alexa.RTCSessionController', name, messageId: 'incoming', payloadVersion: '3', correlationToken: 'opaque' },
    endpoint: { endpointId },
    payload: { sessionId, offer: { format: 'SDP', value: 'v=0\r\no=offer' } },
  };
}
function fixture(options: { delay?: number; fail?: boolean; noAnswer?: boolean; online?: boolean } = {}) {
  let starts = 0, ends = 0;
  const camera = {
    id: 'camera-1', name: 'Front Door', online: options.online ?? true,
    async startRTCSignalingSession(session: any) {
      starts++;
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
      if (options.fail) throw new Error('camera failure');
      const offer = await session.createLocalDescription('offer', {});
      assert.equal(offer.sdp, 'v=0\r\no=offer');
      assert.equal((await session.getOptions()).disableTurn, false);
      if (!options.noAnswer) await session.setRemoteDescription({ type: 'answer', sdp: 'v=0\r\no=answer' }, {});
      return { endSession: async () => { ends++; }, setPlayback: async (playback: any) => { assert.equal(playback.audio, false); } };
    },
  } as unknown as Camera;
  return { camera, counts: () => ({ starts, ends }) };
}

test('discovery includes only supplied cameras with RTC and retrievable health', async () => {
  const { camera } = fixture();
  const bridge = new CameraBridge(() => [camera]);
  const d = request('Discover'); d.header.namespace = 'Alexa.Discovery'; delete d.endpoint;
  const result = await bridge.handle(d);
  const endpoints = result.event.payload.endpoints;
  assert.equal(endpoints.length, 1);
  assert.equal(endpoints[0].endpointId, 'camera-1');
  assert.deepEqual(endpoints[0].displayCategories, ['CAMERA']);
  assert.equal(endpoints[0].capabilities[1].interface, 'Alexa.RTCSessionController');
  assert.equal(endpoints[0].capabilities[2].properties.proactivelyReported, false);
  assert.equal((await new CameraBridge(() => []).handle(d)).event.payload.endpoints.length, 0);
});

test('WebRTC answer preserves correlation, avoids echoing offer, and duplicate start is idempotent', async () => {
  const { camera, counts } = fixture({ delay: 5 });
  const bridge = new CameraBridge(() => [camera]);
  const [first, second] = await Promise.all([bridge.handle(request('InitiateSessionWithOffer')), bridge.handle(request('InitiateSessionWithOffer'))]);
  assert.equal(first.event.header.name, 'AnswerGeneratedForSession');
  assert.equal(first.event.header.correlationToken, 'opaque');
  assert.notEqual(first.event.header.messageId, 'incoming');
  assert.deepEqual(first.event.payload, { answer: { format: 'SDP', value: 'v=0\r\no=answer' } });
  assert.deepEqual(first.event.payload, second.event.payload);
  assert.equal(counts().starts, 1);
  assert.equal((await bridge.handle(request('SessionConnected'))).event.header.name, 'SessionConnected');
  await bridge.handle(request('SessionDisconnected'));
  await bridge.handle(request('SessionDisconnected'));
  assert.equal(counts().ends, 1);
});

test('removed/unknown and offline cameras return specific errors', async () => {
  const { camera } = fixture({ online: false });
  const bridge = new CameraBridge(() => [camera]);
  assert.equal((await bridge.handle(request('InitiateSessionWithOffer', 'unknown'))).event.payload.type, 'NO_SUCH_ENDPOINT');
  assert.equal((await bridge.handle(request('InitiateSessionWithOffer'))).event.payload.type, 'ENDPOINT_UNREACHABLE');
  const d = request('ReportState'); d.header.namespace = 'Alexa';
  assert.equal((await bridge.handle(d) as any).context.properties[0].value.value, 'UNREACHABLE');
});

test('startup failures and timeouts become Alexa errors; late controls are closed', async () => {
  const failed = fixture({ fail: true });
  assert.equal((await new CameraBridge(() => [failed.camera], 10).handle(request('InitiateSessionWithOffer'))).event.payload.type, 'ENDPOINT_UNREACHABLE');
  const late = fixture({ delay: 30 });
  assert.equal((await new CameraBridge(() => [late.camera], 5).handle(request('InitiateSessionWithOffer'))).event.payload.type, 'ENDPOINT_UNREACHABLE');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(late.counts().ends, 1);
});

test('silent sessions expire even if Alexa never disconnects', async () => {
  const { camera, counts } = fixture();
  const bridge = new CameraBridge(() => [camera], 50, 15);
  await bridge.handle(request('InitiateSessionWithOffer'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(counts().ends, 1);
});

test('session IDs cannot cross cameras and invalid offers are rejected', async () => {
  const { camera } = fixture();
  const second = { ...camera, id: 'camera-2' } as Camera;
  const bridge = new CameraBridge(() => [camera, second]);
  const invalid = request('InitiateSessionWithOffer'); invalid.payload.offer.format = 'RTSP';
  assert.equal((await bridge.handle(invalid)).event.payload.type, 'INVALID_DIRECTIVE');
  await bridge.handle(request('InitiateSessionWithOffer'));
  assert.equal((await bridge.handle(request('SessionDisconnected', 'camera-2'))).event.payload.type, 'INVALID_DIRECTIVE');
  const changed = request('InitiateSessionWithOffer'); changed.payload.offer.value = 'v=0\r\no=different';
  assert.equal((await bridge.handle(changed)).event.payload.type, 'INVALID_DIRECTIVE');
  await bridge.handle(request('SessionDisconnected'));
});
