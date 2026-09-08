import sdk, { HttpRequest, HttpRequestHandler, HttpResponse, ScryptedDeviceBase, ScryptedInterface, Setting, Settings, SettingValue } from '@scrypted/sdk';
import { isDirective } from '../../shared/alexa';
import { authorized } from './auth';
import { Camera, CameraBridge } from './cameras';

class PersonalAlexaCameras extends ScryptedDeviceBase implements Settings, HttpRequestHandler {
  private bridge = new CameraBridge(() => this.selectedCameras());

  private selectedIds(): string[] {
    try { return JSON.parse(this.storage.getItem('cameras') || '[]'); } catch { return []; }
  }
  private selectedCameras(): Camera[] {
    return this.selectedIds().map(id => sdk.systemManager.getDeviceById<Camera>(id))
      .filter((camera): camera is Camera => !!camera?.interfaces.includes(ScryptedInterface.RTCSignalingChannel));
  }
  async getSettings(): Promise<Setting[]> {
    return [
      { key: 'secret', title: 'Bridge secret', description: 'Paste the AWS Secrets Manager bridge secret. At least 32 characters.', type: 'password', value: this.storage.getItem('secret') || '' },
      { key: 'cameras', title: 'Cameras exposed to Alexa', description: 'Enable the Scrypted WebRTC extension on each selected camera.', type: 'device', multiple: true, deviceFilter: `interfaces.includes('${ScryptedInterface.RTCSignalingChannel}')`, value: this.selectedIds() },
      { key: 'endpoint', title: 'Local plugin endpoint', type: 'string', readonly: true, value: await sdk.endpointManager.getPublicLocalEndpoint(), description: 'Expose only this path through your HTTPS reverse proxy or tunnel and set scryptedEndpoint to its public URL.' },
    ];
  }
  async putSetting(key: string, value: SettingValue) {
    if (key === 'secret') {
      if (typeof value !== 'string' || value.length < 32) throw new Error('Secret must contain at least 32 characters.');
      this.storage.setItem(key, value);
    } else if (key === 'cameras') {
      if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) throw new Error('Select camera devices.');
      this.storage.setItem(key, JSON.stringify(value));
    }
  }
  async onRequest(request: HttpRequest, response: HttpResponse) {
    const send = (body: unknown, code = 200) => response.send(JSON.stringify(body), { code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (!authorized(request.headers?.authorization, this.storage.getItem('secret'))) { send({ error: 'Unauthorized' }, 401); return; }
    if (request.method !== 'POST') { send({ error: 'Method not allowed' }, 405); return; }
    try {
      if (!request.body || request.body.length > 256_000) { send({ error: 'Invalid body size' }, 413); return; }
      const input: unknown = JSON.parse(request.body);
      if (!isDirective(input)) { send({ error: 'Invalid directive' }, 400); return; }
      send(await this.bridge.handle(input.directive));
    } catch {
      this.console.warn('Camera directive failed. Check camera and WebRTC configuration.');
      send({ error: 'Camera bridge failure' }, 500);
    }
  }
}

export default PersonalAlexaCameras;
