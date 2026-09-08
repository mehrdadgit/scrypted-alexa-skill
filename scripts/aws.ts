import { spawnSync } from 'node:child_process';

export class AwsError extends Error {
  constructor(public readonly code: string, operation: string) {
    super(`AWS ${operation} failed (${code}); check profile, permissions and region. Raw output withheld.`);
  }
}
export function aws(args: string[]): any {
  const result = spawnSync('aws', [...args, '--region', 'us-west-2', '--output', 'json',
    ...(process.env.AWS_PROFILE ? ['--profile', process.env.AWS_PROFILE] : [])],
  { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, env: { ...process.env, AWS_PAGER: '' } });
  if (result.error) throw new Error('AWS CLI could not start. Install AWS CLI v2 and check PATH.');
  if (result.status !== 0) {
    const code = result.stderr.match(/An error occurred \(([A-Za-z0-9]+)\)/)?.[1] || 'CLIError';
    throw new AwsError(code, args.slice(0, 2).join(' '));
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}
