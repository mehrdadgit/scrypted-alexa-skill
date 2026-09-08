import { randomUUID } from 'node:crypto';

export interface Directive {
  header: { namespace: string; name: string; messageId: string; payloadVersion: string; correlationToken?: string };
  endpoint?: { endpointId: string; scope?: { type: string; token: string }; cookie?: Record<string, string> };
  payload: Record<string, any>;
}

export function isDirective(value: unknown): value is { directive: Directive } {
  const d = (value as any)?.directive;
  return !!d && typeof d.header?.namespace === 'string' && typeof d.header?.name === 'string'
    && typeof d.header?.messageId === 'string' && d.header.payloadVersion === '3'
    && !!d.payload && typeof d.payload === 'object' && !Array.isArray(d.payload)
    && (d.endpoint === undefined || typeof d.endpoint?.endpointId === 'string');
}

export function reply(d: Directive, namespace: string, name: string, payload: Record<string, any> = {}) {
  return {
    event: {
      header: {
        namespace, name, messageId: randomUUID(), payloadVersion: '3',
        ...(d.header.correlationToken ? { correlationToken: d.header.correlationToken } : {}),
      },
      ...(d.endpoint ? { endpoint: { endpointId: d.endpoint.endpointId } } : {}),
      payload,
    },
  };
}

export function errorReply(d: Directive, type: string, message: string) {
  return reply(d, 'Alexa', 'ErrorResponse', { type, message });
}

export function accessToken(d: Directive): string | undefined {
  const scope = d.header.namespace === 'Alexa.Discovery' ? d.payload.scope : d.endpoint?.scope;
  return scope?.type === 'BearerToken' && typeof scope.token === 'string' ? scope.token : undefined;
}
