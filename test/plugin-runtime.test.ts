import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('packaged plugin initializes with the current Scrypted CommonJS runtime module', async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  const runtime = {
    deviceManager: { getDeviceStorage: () => storage, getDeviceLogger: () => ({}), getDeviceConsole: () => console },
    endpointManager: { getPublicLocalEndpoint: async () => 'https://127.0.0.1:10443/endpoint/scrypted-alexa-au/public/' },
    systemManager: { setScryptedInterfaceDescriptors: async () => {}, getSystemState: () => ({}) },
  };
  const exported: any = {};
  const errors: unknown[][] = [];
  runInNewContext(readFileSync('scrypted-plugin/dist/main.nodejs.js', 'utf8'), {
    exports: exported, Buffer, setTimeout, clearTimeout,
    process: { env: { SCRYPTED_SDK_CJS_MODULE: '/scrypted/runtime.cjs' } },
    console: { log() {}, warn: (...args: unknown[]) => errors.push(args), error: (...args: unknown[]) => errors.push(args) },
    require: (name: string) => {
      if (name === '/scrypted/runtime.cjs') return { getScryptedStatic: () => runtime };
      if (name === 'fs') return { readFileSync: () => '{"version":"test"}' };
      return require(name);
    },
  });
  assert.equal(errors.length, 0, errors.map(args => args.map(String).join(' ')).join('\n'));
  const plugin = new exported.default();
  const settings = await plugin.getSettings();
  assert.equal(settings.find((s: any) => s.key === 'secret').value, '');
  let status: number | undefined;
  await plugin.onRequest({ method: 'GET', headers: {} }, { send: (_body: string, options: any) => { status = options.code; } });
  assert.equal(status, 401);
});
