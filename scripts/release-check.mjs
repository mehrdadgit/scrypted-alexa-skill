import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, lstatSync } from 'node:fs';

// Inspect tracked files plus unignored new files: exactly the candidates for a normal git add.
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
const privateValues = new Set();
function collect(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'string' && /^(password|clientSecret|SecretString|access_token|refresh_token|token)$/i.test(key) && v.length >= 12) privateValues.add(v);
    else collect(v);
  }
}
for (const file of ['.local/camera-login.json', '.local/account-linking.json']) {
  if (existsSync(file)) { try { collect(JSON.parse(readFileSync(file, 'utf8'))); } catch { throw new Error('Cannot inspect private credentials for release checking. Fix the local JSON file first.'); } }
}
if (existsSync('.local/bridge-secret.txt')) {
  const secret = readFileSync('.local/bridge-secret.txt', 'utf8').trim();
  if (secret.length >= 12) privateValues.add(secret);
}
if (existsSync('.env.local')) {
  const env = readFileSync('.env.local', 'utf8');
  const email = env.match(/^CAMERA_LOGIN_EMAIL\s*=\s*["']?([^\s"'\r\n]+)/m)?.[1];
  if (email && !email.endsWith('@example.com')) privateValues.add(email);
  const endpoint = env.match(/^SCRYPTED_ENDPOINT\s*=\s*["']?([^\s"'\r\n]+)/m)?.[1];
  if (endpoint) { try { const host = new URL(endpoint).hostname; if (!host.endsWith('.example.com')) privateValues.add(host); } catch {} }
}
const failures = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  if (/(^|\/)(\.local|\.ask|\.aws|\.scrypted|\.cloudflared|node_modules|cdk\.out)(\/|$)/.test(file)
    || /(^|\/)config\.local\.json$/.test(file)
    || /(^|\/)\.env(?:\..*)?$/.test(file) && file !== '.env.local.example'
    || /\.(pem|key|p12)$/.test(file)
    || /^scrypted-plugin\/(dist|out|fs)\//.test(file)) failures.push([file, 'private/generated file']);
  if (lstatSync(file).isSymbolicLink()) { failures.push([file, 'review symlink before publishing']); continue; }
  const text = readFileSync(file, 'utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text)) failures.push([file, 'credential pattern']);
  if ([...privateValues].some(v => text.includes(v))) failures.push([file, 'matches local private data']);
  if (/\/Users\/[^/\s]+\//.test(text)) failures.push([file, 'personal absolute path']);
}
if (failures.length) {
  for (const [file, reason] of failures) console.error(`FAIL: ${file} (${reason}; matching content withheld)`);
  process.exitCode = 1;
} else console.log(`PASS: ${files.length} Git candidate files checked. No detected private files, known local secrets or personal paths. Review the diff and Git history separately; this is not a complete secret scanner.`);
