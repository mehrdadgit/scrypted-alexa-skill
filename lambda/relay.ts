import { accessToken, errorReply, isDirective } from '../shared/alexa';

export interface Dependencies {
  verify: (token: string) => Promise<{ scope?: string }>;
  getSecret: () => Promise<string>;
  endpoint: string;
  fetch: typeof fetch;
}

export function createHandler(deps: Dependencies) {
  return async (input: unknown) => {
    if (!isDirective(input)) throw new Error('Malformed Alexa directive');
    const d = input.directive;
    const token = accessToken(d);
    try {
      if (!token) throw new Error('Missing token');
      const claims = await deps.verify(token);
      if (!claims.scope?.split(' ').includes('cameras/access')) throw new Error('Missing scope');
    } catch {
      return errorReply(d, 'INVALID_AUTHORIZATION_CREDENTIAL', 'Relink the camera skill.');
    }
    let stage = 'secret';
    let httpStatus: number | undefined;
    let cloudflareRay: string | undefined;
    let cloudflareChallenge = false;
    try {
      const secret = await deps.getSecret();
      const forwarded = structuredClone(input);
      delete forwarded.directive.payload.scope;
      if (forwarded.directive.endpoint) delete forwarded.directive.endpoint.scope;
      stage = 'https';
      const result = await deps.fetch(deps.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify(forwarded),
        signal: AbortSignal.timeout(6500),
        redirect: 'error',
      });
      httpStatus = result.status;
      const ray = result.headers.get('cf-ray') || '';
      cloudflareRay = /^[a-f0-9]{16,32}-[A-Z]{3}$/.test(ray) ? ray : undefined;
      cloudflareChallenge = result.headers.get('cf-mitigated') === 'challenge';
      if (!result.ok) throw new Error('Bridge HTTP error');
      stage = 'response';
      const body = await result.json() as any;
      if (!body?.event?.header || body.event.header.payloadVersion !== '3') throw new Error('Invalid bridge response');
      console.info('Scrypted bridge response', { namespace: d.header.namespace, name: d.header.name,
        response: body.event.header.name,
        ...(d.header.namespace === 'Alexa.Discovery' ? { endpointCount: body.event.payload?.endpoints?.length ?? 0 } : {}),
      });
      return body;
    } catch (error) {
      // Deliberately exclude tokens, SDP, URLs and raw upstream errors from logs.
      const knownErrors = new Set(['AccessDeniedException', 'ResourceNotFoundException', 'TimeoutError', 'AbortError',
        'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']);
      const cause = error as { name?: string; cause?: { code?: string } };
      const code = cause?.cause?.code || cause?.name || '';
      console.warn('Scrypted bridge request failed', { namespace: d.header.namespace, name: d.header.name,
        messageId: d.header.messageId, stage, httpStatus, cloudflareRay, cloudflareChallenge,
        reason: knownErrors.has(code) ? code : 'upstream_error' });
      return errorReply(d, 'BRIDGE_UNREACHABLE', 'Check the Scrypted server and its HTTPS endpoint.');
    }
  };
}
