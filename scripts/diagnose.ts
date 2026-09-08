import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, mkdtempSync, chmodSync } from 'node:fs';
import { loadConfig, validateDeployConfig } from '../lib/config';
import { aws } from './aws';
import { command, writePrivate } from './io';
import { readDeployment } from './deployment';
import { checkDiscovery, checkHttp } from './diagnostics';
import { loginForAccessToken } from './oauth';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--login') || args.length > 1) throw new Error('Usage: npm run diagnose -- [--login]');
  const config = loadConfig(); validateDeployConfig(config);
  const out = readDeployment();
  if (out.ScryptedEndpoint !== config.scryptedEndpoint) throw new Error('Local endpoint differs from deployed endpoint. Configure and deploy, or restore your local settings.');
  if (!config.skillId) throw new Error('Set the existing skill ID before diagnosing.');
  const policy = JSON.parse(aws(['lambda', 'get-policy', '--function-name', out.FunctionArn]).Policy);
  if (!policy.Statement.some((s: any) => s.Principal?.Service === 'alexa-connectedhome.amazon.com' && s.Condition?.StringEquals?.['lambda:EventSourceToken'] === config.skillId))
    throw new Error('Lambda permission does not match this skill ID. Redeploy after setting the correct ID.');
  const ask = (args: string[]) => JSON.parse(command('node_modules/.bin/ask', ['smapi', ...args, ...(process.env.ASK_PROFILE ? ['--profile', process.env.ASK_PROFILE] : [])], true));
  const status = ask(['get-skill-status', '--skill-id', config.skillId]);
  if (status.manifest?.lastUpdateRequest?.status !== 'SUCCEEDED') throw new Error('Alexa manifest has not succeeded. Run npm run skill -- status.');
  const remoteManifest = ask(['get-skill-manifest', '--skill-id', config.skillId, '--stage', 'development']).manifest;
  if (remoteManifest?.apis?.smartHome?.regions?.FE?.endpoint?.uri !== out.FunctionArn) throw new Error('Alexa FE endpoint differs from Lambda. Run skill -- update.');
  const linkingResult = ask(['get-account-linking-info', '--skill-id', config.skillId, '--stage', 'development']);
  const linking = linkingResult.accountLinkingResponse || linkingResult;
  if (linking.clientId !== out.UserPoolClientId || linking.authorizationUrl !== out.AuthorizationUrl || linking.accessTokenUrl !== out.TokenUrl || !linking.scopes?.includes('cameras/access'))
    throw new Error('Alexa account linking differs from the deployed Cognito client. Run skill -- link.');
  console.log('PASS: AWS stack, scoped Lambda trigger, Alexa manifest and account linking.');
  const secret = aws(['secretsmanager', 'get-secret-value', '--secret-id', out.BridgeSecretArn]).SecretString;
  if (typeof secret !== 'string' || !secret) throw new Error('Bridge secret missing.');
  const directive = { header: { namespace: 'Alexa.Discovery', name: 'Discover', messageId: randomUUID(), payloadVersion: '3' }, payload: {} };
  const response = await fetch(out.ScryptedEndpoint, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ directive }) });
  checkHttp(response);
  console.log(`PASS: HTTPS discovery from this computer: ${checkDiscovery(await response.json()).join(', ')}`);
  if (!args.includes('--login')) {
    console.log('AWS-to-Scrypted reachability is NOT tested yet. Run npm run diagnose -- --login for authenticated Lambda discovery.');
    return;
  }
  const login = JSON.parse(readFileSync('.local/camera-login.json', 'utf8'));
  if (login.userPoolId !== out.UserPoolId || login.username !== process.env.CAMERA_LOGIN_EMAIL?.trim()) throw new Error('Saved camera login does not match the configured email and deployed pool.');
  const client = aws(['cognito-idp', 'describe-user-pool-client', '--user-pool-id', out.UserPoolId, '--client-id', out.UserPoolClientId]).UserPoolClient;
  const token = await loginForAccessToken({ authorizationUrl: out.AuthorizationUrl, tokenUrl: out.TokenUrl, clientId: out.UserPoolClientId, clientSecret: client.ClientSecret, redirectUri: config.alexaRedirectUrls[0], username: login.username, password: login.password });
  const dir = mkdtempSync('.local/diagnose-'); chmodSync(dir, 0o700);
  try {
    const input = `${dir}/request.json`; const output = `${dir}/response.json`;
    writePrivate(input, { directive: { ...directive, payload: { scope: { type: 'BearerToken', token } } } });
    const meta = aws(['lambda', 'invoke', '--function-name', out.FunctionArn, '--cli-binary-format', 'raw-in-base64-out', '--payload', `file://${input}`, output]);
    if (meta.FunctionError) throw new Error('Lambda invocation failed. Inspect its CloudWatch log group.');
    console.log(`PASS: Authenticated AWS discovery: ${checkDiscovery(JSON.parse(readFileSync(output, 'utf8'))).join(', ')}`);
    console.log('Video is not tested. Discover devices and start/stop playback on your Alexa display.');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => {
  // Network/JSON errors can embed URLs or body fragments; print only our known diagnostic errors.
  if (error instanceof SyntaxError || error instanceof TypeError) console.error('Diagnostic failed: unexpected response or network failure. Check endpoint, saved files and service logs.');
  else console.error(error.message);
  process.exitCode = 1;
});
