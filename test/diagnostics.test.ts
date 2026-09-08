import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDiscovery, checkHttp } from '../scripts/diagnostics';
import { loginForAccessToken, OAuthOptions } from '../scripts/oauth';

const settings: OAuthOptions = { authorizationUrl: 'https://login.example.com/oauth2/authorize', tokenUrl: 'https://login.example.com/oauth2/token', clientId: 'client', clientSecret: 'client-secret', redirectUri: 'https://alexa.amazon.co.jp/api/skill/link/VENDOR', username: 'person@example.com', password: 'private-password' };

test('diagnostics reject zero cameras, Alexa errors and browser challenges', () => {
  const body = { event: { header: { namespace: 'Alexa.Discovery', name: 'Discover.Response', payloadVersion: '3' }, payload: { endpoints: [] as any[] } } };
  assert.throws(() => checkDiscovery(body), /No cameras/);
  body.event.payload.endpoints.push({ endpointId: 'cam', friendlyName: 'Door' });
  assert.deepEqual(checkDiscovery(body), ['Door']);
  assert.throws(() => checkDiscovery({ event: { header: { name: 'ErrorResponse' } } }), /Expected/);
  assert.throws(() => checkHttp(new Response('sensitive HTML', { status: 403, headers: { 'cf-mitigated': 'challenge' } })), /Bot Fight Mode/);
  assert.throws(() => checkHttp(new Response('sensitive', { status: 401 })), /secret/);
  assert.doesNotThrow(() => checkHttp(new Response('{}')));
});

test('OAuth diagnostic preserves CSRF cookies and state, exchanges code, and never follows Amazon callback', async () => {
  let step = 0; let state = '';
  const mock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://login.example.com');
    if (step++ === 0) {
      state = url.searchParams.get('state')!;
      assert.ok(state);
      return new Response(null, { status: 302, headers: { location: '/login', 'set-cookie': 'session=abc; Secure; HttpOnly' } });
    }
    if (step === 2) return new Response('<form action="/login" name="cognitoSignInForm"><input type="hidden" name="_csrf" value="csrf-value"></form>');
    if (step === 3) {
      const body = new URLSearchParams(init?.body as string);
      assert.equal(body.get('_csrf'), 'csrf-value');
      assert.equal(body.get('password'), settings.password);
      assert.equal(new Headers(init?.headers).get('cookie'), 'session=abc');
      return new Response(null, { status: 302, headers: { location: `${settings.redirectUri}?code=authorization-code&state=${state}` } });
    }
    assert.equal(url.pathname, '/oauth2/token');
    assert.equal(new URLSearchParams(init?.body as string).get('code'), 'authorization-code');
    return new Response(JSON.stringify({ access_token: 'test-token' }));
  }) as typeof fetch;
  assert.equal(await loginForAccessToken(settings, mock), 'test-token');
  assert.equal(step, 4);
});

for (const attack of ['form-origin', 'callback-state']) test(`OAuth diagnostic rejects ${attack} before exposing credentials or exchanging tokens`, async () => {
  let calls = 0;
  const mock = (async () => {
    calls++;
    if (calls === 1) return new Response(`<form action="${attack === 'form-origin' ? 'https://outside.example/login' : '/login'}" name="cognitoSignInForm"><input type="hidden" name="_csrf" value="csrf"></form>`);
    if (calls === 2 && attack === 'callback-state') return new Response(null, { status: 302, headers: { location: `${settings.redirectUri}?code=private&state=wrong` } });
    assert.fail('must not make another request');
  }) as typeof fetch;
  await assert.rejects(loginForAccessToken(settings, mock), attack === 'form-origin' ? /origin/ : /callback/);
  assert.equal(calls, attack === 'form-origin' ? 1 : 2);
});
