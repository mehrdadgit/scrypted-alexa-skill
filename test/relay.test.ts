import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, Dependencies } from '../lambda/relay';
import { Directive } from '../shared/alexa';
import { authorized } from '../scrypted-plugin/src/auth';

export function directive(namespace = 'Alexa.Discovery', name = 'Discover'): Directive {
  return {
    header: { namespace, name, messageId: 'test-message', payloadVersion: '3', correlationToken: 'correlation' },
    payload: { scope: { type: 'BearerToken', token: 'user-token' } },
  };
}
const goodResponse = { event: { header: { namespace: 'Alexa.Discovery', name: 'Discover.Response', payloadVersion: '3', messageId: 'reply' }, payload: { endpoints: [] } } };
function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    verify: async () => ({ scope: 'openid cameras/access' }),
    getSecret: async () => 'bridge-secret',
    endpoint: 'https://bridge.example/endpoint/scrypted-alexa-au/public/',
    fetch: async () => new Response(JSON.stringify(goodResponse)),
    ...overrides,
  };
}

test('relay validates token and strips user credentials before forwarding', async () => {
  const input = { directive: directive() };
  const handler = createHandler(dependencies({
    verify: async token => { assert.equal(token, 'user-token'); return { scope: 'cameras/access' }; },
    fetch: async (url, init) => {
      assert.equal(url, 'https://bridge.example/endpoint/scrypted-alexa-au/public/');
      assert.equal((init?.headers as any).authorization, 'Bearer bridge-secret');
      assert.equal(init?.redirect, 'error');
      assert.equal(JSON.parse(init?.body as string).directive.payload.scope, undefined);
      return new Response(JSON.stringify(goodResponse));
    },
  }));
  assert.deepEqual(await handler(input), goodResponse);
  assert.equal(input.directive.payload.scope.token, 'user-token');
});

for (const mode of ['missing', 'invalid', 'scope']) test(`relay rejects ${mode} authorization before accessing bridge secrets`, async () => {
  const d = directive();
  if (mode === 'missing') delete d.payload.scope;
  const handler = createHandler(dependencies({
    verify: async () => { if (mode === 'invalid') throw new Error('expired JWT'); return { scope: 'openid' }; },
    getSecret: async () => { assert.fail('must not read secret'); },
    fetch: async () => { assert.fail('must not contact bridge'); },
  }));
  const result = await handler({ directive: d });
  assert.equal(result.event.payload.type, 'INVALID_AUTHORIZATION_CREDENTIAL');
});

test('endpoint directive uses endpoint token and forwards SDP intact', async () => {
  const d = directive('Alexa.RTCSessionController', 'InitiateSessionWithOffer');
  d.endpoint = { endpointId: 'camera-1', scope: { type: 'BearerToken', token: 'endpoint-token' } };
  d.payload = { sessionId: 'session', offer: { format: 'SDP', value: 'v=0\r\n' } };
  const handler = createHandler(dependencies({
    verify: async token => { assert.equal(token, 'endpoint-token'); return { scope: 'cameras/access' }; },
    fetch: async (_, init) => {
      const forwarded = JSON.parse(init?.body as string).directive;
      assert.equal(forwarded.endpoint.scope, undefined);
      assert.deepEqual(forwarded.payload, d.payload);
      return new Response(JSON.stringify(goodResponse));
    },
  }));
  await handler({ directive: d });
});

for (const mode of ['http', 'json', 'schema', 'timeout']) test(`relay maps ${mode} failure to a correlated Alexa bridge error`, async () => {
  const handler = createHandler(dependencies({ fetch: async () => {
    if (mode === 'timeout') throw new Error('timeout includes secret');
    if (mode === 'http') return new Response('secret upstream message', { status: 403 });
    if (mode === 'json') return new Response('<html>login</html>');
    return new Response('{}');
  } }));
  const result = await handler({ directive: directive() });
  assert.equal(result.event.payload.type, 'BRIDGE_UNREACHABLE');
  assert.equal(result.event.header.correlationToken, 'correlation');
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('malformed input is rejected', async () => {
  await assert.rejects(createHandler(dependencies())({ directive: {} }), /Malformed/);
});

test('bridge diagnostics identify failure stage and status without exposing secrets', async t => {
  const log = t.mock.method(console, 'warn', () => {});
  await createHandler(dependencies({ fetch: async () => new Response('sensitive upstream body', { status: 403,
    headers: { 'cf-ray': 'abcdef0123456789-PDX', 'cf-mitigated': 'challenge' } }) }))({ directive: directive() });
  const diagnostic = log.mock.calls[0].arguments[1];
  assert.equal(diagnostic.stage, 'https');
  assert.equal(diagnostic.httpStatus, 403);
  assert.equal(diagnostic.cloudflareRay, 'abcdef0123456789-PDX');
  assert.equal(diagnostic.cloudflareChallenge, true);
  await createHandler(dependencies({ getSecret: async () => { throw Object.assign(new Error('sensitive secret ARN'), { name: 'AccessDeniedException' }); } }))({ directive: directive() });
  assert.equal(log.mock.calls[1].arguments[1].stage, 'secret');
  assert.equal(log.mock.calls[1].arguments[1].reason, 'AccessDeniedException');
  const text = JSON.stringify(log.mock.calls.map(call => call.arguments));
  for (const value of ['sensitive', 'user-token', 'bridge-secret']) assert.ok(!text.includes(value));
});

test('plugin bearer authentication fails closed', () => {
  const secret = 'x'.repeat(64);
  assert.equal(authorized(`Bearer ${secret}`, secret), true);
  for (const header of [undefined, '', secret, `Bearer ${'y'.repeat(64)}`, `Bearer ${secret}x`]) assert.equal(authorized(header, secret), false);
  assert.equal(authorized('Bearer ', ''), false);
  assert.equal(authorized('Bearer short', 'short'), false);
});
