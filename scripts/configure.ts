import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig, validateDeployConfig, validateEndpoint } from '../lib/config';
import { writePrivate } from './io';

async function main() {
  const current = loadConfig();
  const file = process.env.CONFIG_FILE || 'config.local.json';
  if (process.argv.includes('--env')) {
    validateDeployConfig(current);
    writePrivate(file, current);
    console.log(`Saved ${file} from environment settings. Existing skill ID preserved. No resources deployed.`);
    return;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const name = await rl.question(`Skill name [${current.skillName}]: `);
    const endpoint = await rl.question('Public HTTPS URL of the companion plugin (ending /public/): ');
    const vendor = (await rl.question('Amazon Developer vendor ID (from ask smapi get-vendor-list): ')).trim();
    if (!/^[A-Za-z0-9]+$/.test(vendor)) throw new Error('Vendor ID must be alphanumeric.');
    writePrivate(file, {
      skillName: name.trim() || current.skillName,
      scryptedEndpoint: validateEndpoint(endpoint.trim()),
      alexaRedirectUrls: ['pitangui.amazon.com', 'layla.amazon.com', 'alexa.amazon.co.jp'].map(host => `https://${host}/api/skill/link/${vendor}`),
      skillId: current.skillId || '',
    });
    console.log('Saved config.local.json. Verify the redirect URLs against the Alexa console after skill creation.');
  } finally { rl.close(); }
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
