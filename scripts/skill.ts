import { loadConfig } from '../lib/config';
import { command, outputs, writePrivate } from './io';
import { creationManifest, manifest } from './manifest';

const askArgs = process.env.ASK_PROFILE ? ['--profile', process.env.ASK_PROFILE] : [];
const awsArgs = ['--region', 'us-west-2', '--output', 'json', ...(process.env.AWS_PROFILE ? ['--profile', process.env.AWS_PROFILE] : [])];

async function main() {
  const action = process.argv[2];
  if (!['prepare', 'create', 'update', 'link', 'status'].includes(action)) throw new Error('Usage: npm run skill -- prepare|create|update|link|status');
  const config = loadConfig();
  const out = outputs();
  const ask = (args: string[], sensitive = false) => command('node_modules/.bin/ask', ['smapi', ...args, ...askArgs], sensitive);
  if (['prepare', 'create', 'update'].includes(action)) {
    writePrivate('.local/skill.json', manifest(config, out.FunctionArn));
    if (action === 'prepare') { console.log('Prepared .local/skill.json'); return; }
    if (action === 'create') {
      if (config.skillId) throw new Error('A skill ID is already configured. Use update.');
      writePrivate('.local/skill-create.json', creationManifest(config, out.FunctionArn));
      const raw = ask(['create-skill-for-vendor', '--manifest', 'file:.local/skill-create.json', '--full-response']);
      const result = JSON.parse(raw);
      writePrivate('.local/skill-create-response.json', result);
      const location = result.headers?.location || result.headers?.Location || '';
      const id = result.body?.skillId || result.skillId || location.match(/amzn1\.ask\.skill\.[a-zA-Z0-9-]+/)?.[0];
      if (!id) throw new Error('Skill created, but its ID could not be parsed. Read .local/skill-create-response.json and set skillId in config.local.json. Do not run create again.');
      config.skillId = id;
      writePrivate(process.env.CONFIG_FILE || 'config.local.json', config);
      console.log(`Requested development skill ${id}. Run skill -- status and wait for SUCCEEDED, then redeploy CDK to add its restricted Lambda trigger. Run skill -- update and skill -- status; once validation succeeds, run skill -- link.`);
      return;
    }
    if (!config.skillId) throw new Error('Set skillId first.');
    ask(['update-skill-manifest', '--skill-id', config.skillId, '--stage', 'development', '--manifest', 'file:.local/skill.json']);
    console.log('Development manifest updated.');
    return;
  }
  if (!config.skillId) throw new Error('Create a skill first.');
  if (action === 'status') {
    console.log(ask(['get-skill-status', '--skill-id', config.skillId]));
    return;
  }
  const client = JSON.parse(command('aws', ['cognito-idp', 'describe-user-pool-client', '--user-pool-id', out.UserPoolId, '--client-id', out.UserPoolClientId, ...awsArgs], true));
  const linking = {
    accountLinkingRequest: {
      type: 'AUTH_CODE', skipOnEnablement: false,
      authorizationUrl: out.AuthorizationUrl, accessTokenUrl: out.TokenUrl,
      clientId: out.UserPoolClientId, clientSecret: client.UserPoolClient.ClientSecret,
      accessTokenScheme: 'HTTP_BASIC', scopes: ['openid', 'cameras/access'], domains: [],
    },
  };
  if (!linking.accountLinkingRequest.clientSecret) throw new Error('Cognito client secret is missing.');
  writePrivate('.local/account-linking.json', linking);
  ask(['update-account-linking-info', '--skill-id', config.skillId, '--stage', 'development', '--account-linking-request', 'file:.local/account-linking.json'], true);
  console.log('Development account linking configured. Secret-bearing file: .local/account-linking.json (mode 0600).');
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
