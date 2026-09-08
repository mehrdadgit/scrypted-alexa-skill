import { existsSync, mkdirSync } from 'node:fs';
import { loadConfig, validateDeployConfig } from '../lib/config';
const file = process.env.CONFIG_FILE || 'config.local.json';
if (!existsSync(file)) throw new Error('Run npm run configure:env (or npm run configure) before deploying.');
const config = loadConfig();
validateDeployConfig(config);
mkdirSync('.local', { recursive: true, mode: 0o700 });
