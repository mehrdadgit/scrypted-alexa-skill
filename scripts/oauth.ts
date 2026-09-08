import { randomUUID } from 'node:crypto';

export interface OAuthOptions {
  authorizationUrl: string; tokenUrl: string; clientId: string; clientSecret: string;
  redirectUri: string; username: string; password: string;
}
// Diagnostic for this project's classic Cognito username/password login page only.
// All redirects are inspected; credentials never leave the configured Cognito origin.
export async function loginForAccessToken(options: OAuthOptions, fetcher: typeof fetch = fetch): Promise<string> {
  const { authorizationUrl, tokenUrl, clientId, clientSecret, redirectUri, username, password } = options;
  const origin = new URL(authorizationUrl).origin;
  if (new URL(origin).protocol !== 'https:' || new URL(tokenUrl).origin !== origin)
    throw Error('Invalid Cognito origin');
  if (!clientSecret || !username || !password) throw Error('Missing diagnostic login credentials');
  const cookies = new Map<string, string>();
  const state = randomUUID();
  async function request(url: string | URL, init: RequestInit = {}) {
    if (new URL(url).origin !== origin) throw Error('Unexpected OAuth origin');
    const headers = new Headers(init.headers);
    headers.set('cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await fetcher(url, {
      ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const equals = pair.indexOf('=');
      cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
    return response;
  }

  const start = new URL(authorizationUrl);
  start.search = new URLSearchParams({ client_id:clientId, response_type:'code', scope:'openid cameras/access', redirect_uri:redirectUri, state }).toString();
  let url = start.href;
  let r!: Response;
  for (let i = 0; i < 5; i++) {
    r = await request(url);
    if (r.status === 200) break;
    const location = r.headers.get('location');
    if (!location) throw Error('Login redirect missing');
    url = new URL(location,url).href;
  }
  if (r.status !== 200) throw Error('Login page unavailable');
  const html = await r.text();
  const form = html.match(/<form\b[^>]*name="cognitoSignInForm"[^>]*>([\s\S]*?)<\/form>/)?.[0];
  if (!form) throw Error('Login form missing');
  const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const action = decode(form.match(/action="([^"]+)"/)?.[1] || '');
  const body = new URLSearchParams();
  for (const match of form.matchAll(/<input\b[^>]*>/g)) {
    const tag = match[0];
    if (!/type="hidden"/.test(tag)) continue;
    const name = tag.match(/name="([^"]*)"/)?.[1];
    const value = tag.match(/value="([^"]*)"/)?.[1] || '';
    if (name) body.set(name, decode(value));
  }
  if (!body.get('_csrf')) throw Error('Login CSRF field missing');
  body.set('username', username); body.set('password',password);
  body.set('signInSubmitButton','Sign in');
  r = await request(new URL(action,url), { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded',origin,referer:url}, body:body.toString() });
  let callback: URL | undefined;
  for (let i = 0; i < 5; i++) {
    const location = r.headers.get('location');
    if (!location) throw Error(`Login did not issue authorization code (HTTP ${r.status})`);
    const next = new URL(location, url);
    if (next.origin !== origin) { callback=next; break; }
    url=next.href; r=await request(url);
  }
  if (!callback || callback.origin + callback.pathname !== redirectUri || callback.searchParams.get('state') !== state || !callback.searchParams.get('code')) throw Error('Unexpected OAuth callback');
  r=await request(tokenUrl,{ method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',authorization:'Basic '+Buffer.from(`${clientId}:${clientSecret}`).toString('base64')},body:new URLSearchParams({grant_type:'authorization_code',code:callback.searchParams.get('code')!,redirect_uri:redirectUri}).toString() });
  if (!r.ok) throw Error(`Token exchange failed (HTTP ${r.status})`);
  const tokens=await r.json() as { access_token?: string };
  if (typeof tokens.access_token !== 'string' || !tokens.access_token) throw Error('Access token missing');
  return tokens.access_token;
}
