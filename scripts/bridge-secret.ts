import { chmodSync, writeFileSync } from 'node:fs';
import { command, outputs } from './io';

try {
  const out = outputs();
  const args = ['secretsmanager', 'get-secret-value', '--secret-id', out.BridgeSecretArn, '--region', 'us-west-2', '--output', 'json', ...(process.env.AWS_PROFILE ? ['--profile', process.env.AWS_PROFILE] : [])];
  const result = JSON.parse(command('aws', args, true));
  if (typeof result.SecretString !== 'string' || !result.SecretString) throw new Error('Bridge secret missing.');
  const file = '.local/bridge-secret.txt';
  writeFileSync(file, result.SecretString, { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(`Saved ${file} (mode 0600). Copy its contents into the Scrypted plugin's Bridge secret setting.`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
