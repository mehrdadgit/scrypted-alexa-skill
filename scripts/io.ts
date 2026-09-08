import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export function writePrivate(file: string, value: unknown) {
  mkdirSync('.local', { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
}
export function command(program: string, args: string[], sensitive = false): string {
  const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(sensitive ? `${program} failed; inspect the account configuration (secret-bearing output suppressed).` : result.stderr || result.stdout || `${program} failed`);
  return result.stdout;
}
export function outputs(): Record<string, string> {
  return JSON.parse(readFileSync('.local/cdk-outputs.json', 'utf8')).ScryptedAlexaAu;
}
