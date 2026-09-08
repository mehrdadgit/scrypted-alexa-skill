import { existsSync, readFileSync } from 'node:fs';

export interface Config {
  skillName: string;
  scryptedEndpoint: string;
  alexaRedirectUrls: string[];
  skillId?: string;
}

export function validateEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search)
    throw new Error('Scrypted endpoint must be HTTPS without credentials, query, or fragment.');
  if (!url.pathname.endsWith('/public/'))
    throw new Error('Use the companion plugin public endpoint, ending in /public/.');
  return url.href;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const file = env.CONFIG_FILE || 'config.local.json';
  if (env.CONFIG_FILE && !existsSync(file)) throw new Error('CONFIG_FILE does not exist.');
  const config: Config = JSON.parse(readFileSync(existsSync(file) ? file : 'config.example.json', 'utf8'));
  if (env.SKILL_NAME?.trim()) config.skillName = env.SKILL_NAME.trim();
  if (env.SCRYPTED_ENDPOINT?.trim()) config.scryptedEndpoint = env.SCRYPTED_ENDPOINT.trim();
  if (env.ALEXA_VENDOR_ID?.trim()) {
    const vendor = env.ALEXA_VENDOR_ID.trim();
    if (!/^[A-Za-z0-9]+$/.test(vendor)) throw new Error('ALEXA_VENDOR_ID must be alphanumeric.');
    config.alexaRedirectUrls = ['pitangui.amazon.com', 'layla.amazon.com', 'alexa.amazon.co.jp'].map(host => `https://${host}/api/skill/link/${vendor}`);
  }
  if (env.ALEXA_REDIRECT_URLS?.trim()) config.alexaRedirectUrls = JSON.parse(env.ALEXA_REDIRECT_URLS);
  // A blank env value must not discard the ID saved after skill creation.
  if (env.ALEXA_SKILL_ID?.trim()) config.skillId = env.ALEXA_SKILL_ID.trim();
  validateEndpoint(config.scryptedEndpoint);
  if (!config.skillName?.trim()) throw new Error('skillName is required.');
  const hosts = new Set(['pitangui.amazon.com', 'layla.amazon.com', 'alexa.amazon.co.jp']);
  if (!Array.isArray(config.alexaRedirectUrls) || config.alexaRedirectUrls.length < 1)
    throw new Error('At least one Alexa redirect URL is required.');
  for (const value of config.alexaRedirectUrls) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !/^\/api\/skill\/link\/[^/]+$/.test(url.pathname))
      throw new Error('Invalid Alexa authorization-code redirect URL.');
  }
  if (config.skillId && !/^amzn1\.ask\.skill\.[a-zA-Z0-9-]+$/.test(config.skillId))
    throw new Error('Invalid Alexa skill ID.');
  return config;
}

export function validateDeployConfig(config: Config) {
  const hostname = new URL(config.scryptedEndpoint).hostname;
  if (hostname === 'example.com' || hostname.endsWith('.example.com') || hostname.endsWith('.example') || hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname))
    throw new Error('Set SCRYPTED_ENDPOINT to your real public HTTPS hostname, not the Jetson IP or an example domain.');
  if (config.alexaRedirectUrls.some(url => url.includes('YOUR_VENDOR_ID')))
    throw new Error('Set ALEXA_VENDOR_ID or ALEXA_REDIRECT_URLS before deploying.');
}
