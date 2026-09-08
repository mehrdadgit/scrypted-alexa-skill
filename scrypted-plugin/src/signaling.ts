import type { RTCAVSignalingSetup, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession } from '@scrypted/sdk';

/** Alexa is the offerer; Scrypted negotiates the camera side without trickle ICE. */
export class AlexaSignalingSession implements RTCSignalingSession {
  readonly options: RTCSignalingOptions;
  readonly __proxy_props: { options: RTCSignalingOptions };
  readonly answer: Promise<string>;
  private resolveAnswer!: (sdp: string) => void;

  constructor(private readonly offer: string) {
    this.options = {
      proxy: true,
      offer: { type: 'offer', sdp: offer },
      disableTrickle: true,
      disableTurn: false,
      screen: { width: 1920, height: 1080, devicePixelRatio: 1 },
    };
    this.__proxy_props = { options: this.options };
    this.answer = new Promise(resolve => { this.resolveAnswer = resolve; });
  }
  async getOptions() { return this.options; }
  async createLocalDescription(type: 'offer' | 'answer', _setup: RTCAVSignalingSetup, sendIceCandidate?: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
    if (type !== 'offer' || sendIceCandidate) throw new Error('Alexa requires an offer without trickle ICE.');
    return { type: 'offer', sdp: this.offer };
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit, _setup: RTCAVSignalingSetup) {
    if (description.type !== 'answer' || !description.sdp) throw new Error('Expected an SDP answer.');
    this.resolveAnswer(description.sdp);
  }
  async addIceCandidate(): Promise<void> { throw new Error('Trickle ICE is not supported.'); }
}
