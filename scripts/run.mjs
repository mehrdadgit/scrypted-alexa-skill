import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Node parses dotenv syntax without evaluating shell substitutions or commands.
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
if (existsSync('.env.local')) loadEnvFile('.env.local');
const [tool, ...args] = process.argv.slice(2);
const bin = name => resolve('node_modules/.bin', name);
const hasProfile = args.some(arg => arg === '--profile' || arg === '-p' || arg.startsWith('--profile='));
let program;
let childArgs;
let cwd = root;
const env = { ...process.env };

switch (tool) {
  case 'script':
    program = process.execPath;
    childArgs = ['--import', 'tsx', ...args];
    break;
  case 'cdk':
    program = bin('cdk');
    childArgs = args;
    break;
  case 'ask':
    program = bin('ask');
    childArgs = [...args, ...(!hasProfile && env.ASK_PROFILE ? ['--profile', env.ASK_PROFILE] : [])];
    break;
  case 'aws':
    program = 'aws';
    childArgs = [...args, ...(!hasProfile && env.AWS_PROFILE ? ['--profile', env.AWS_PROFILE] : [])];
    env.AWS_PAGER = '';
    break;
  case 'scrypted-login':
  case 'scrypted-deploy': {
    const host = env.SCRYPTED_HOST;
    if (!host || !/^[a-zA-Z0-9.-]+:\d+$/.test(host)) throw new Error('Set SCRYPTED_HOST to a hostname/IP and port, e.g. 192.168.1.100:10443.');
    if (args.length) throw new Error('Set the Scrypted target in .env.local using SCRYPTED_HOST.');
    if (tool === 'scrypted-login') {
      program = 'npx';
      childArgs = ['scrypted', 'login', host];
    } else {
      if (!existsSync('scrypted-plugin/dist/plugin.zip')) throw new Error('Run npm run build before deploying the plugin.');
      program = bin('scrypted-deploy');
      childArgs = [host];
      cwd = resolve('scrypted-plugin');
      env.NODE_ENV = 'production';
    }
    break;
  }
  default: throw new Error(`Unknown project tool: ${tool}`);
}
const result = spawnSync(program, childArgs, { cwd, env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
