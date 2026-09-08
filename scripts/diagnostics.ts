export function checkDiscovery(body: any): string[] {
  if (body?.event?.header?.namespace !== 'Alexa.Discovery' || body.event.header.name !== 'Discover.Response' || body.event.header.payloadVersion !== '3')
    throw new Error('Expected Discover.Response. Check Lambda logs for authorization or bridge errors.');
  const endpoints = body.event.payload?.endpoints;
  if (!Array.isArray(endpoints) || !endpoints.length) throw new Error('No cameras returned. Select cameras with the WebRTC extension in the companion plugin.');
  if (!endpoints.every(e => typeof e.endpointId === 'string' && typeof e.friendlyName === 'string')) throw new Error('Invalid discovered camera metadata.');
  return endpoints.map(e => e.friendlyName);
}
export function checkHttp(response: Response) {
  if (response.headers.get('cf-mitigated') === 'challenge')
    throw new Error('Cloudflare browser challenge. Check Security Events; standard Bot Fight Mode cannot be skipped by a path rule.');
  if (response.status === 401) throw new Error('Bridge rejected its secret. Check the plugin Bridge secret against Secrets Manager.');
  if (!response.ok) throw new Error(`Bridge returned HTTP ${response.status}. Check tunnel routing, Access, WAF and origin logs.`);
}
