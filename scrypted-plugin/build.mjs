import { spawnSync } from 'node:child_process';
const result = spawnSync('scrypted-webpack', [], {
  stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
