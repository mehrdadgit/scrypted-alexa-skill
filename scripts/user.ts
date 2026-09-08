import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { outputs, writePrivate } from './io';
import { aws, AwsError } from './aws';
import { Login, provisionUser } from './user-operation';

function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a.startsWith('--') && !['--resume', '--reset', '--status'].includes(a)) || args.filter(a => a.startsWith('--')).length > 1 || args.filter(a => !a.startsWith('--')).length > 1)
    throw new Error('Usage: npm run user -- [email] [--resume|--reset|--status]');
  const email = args.find(a => !a.startsWith('--')) || process.env.CAMERA_LOGIN_EMAIL?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set CAMERA_LOGIN_EMAIL in .env.local.');
  const out = outputs();
  const file = '.local/camera-login.json';
  const existing: Login | undefined = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  const mode = args.includes('--reset') ? 'reset' : args.includes('--resume') ? 'resume' : 'create';
  const find = () => {
    try { return aws(['cognito-idp', 'admin-get-user', '--user-pool-id', out.UserPoolId, '--username', email]).UserStatus as string; }
    catch (e) { if (e instanceof AwsError && e.code === 'UserNotFoundException') return 'missing'; throw e; }
  };
  if (args.includes('--status')) { console.log(`Camera user status: ${find()}`); return; }
  if (existing && (existing.username !== email || existing.userPoolId !== out.UserPoolId))
    throw new Error('Saved credentials belong to a different account or pool. Back them up and move them before proceeding.');
  if (mode === 'create' && existing) throw new Error('Saved credentials exist. Use --resume for an interrupted creation or --reset for an intentional password replacement.');
  if (mode === 'resume' && (!existing || typeof existing.password !== 'string' || !existing.password)) throw new Error('No valid saved credentials to resume.');
  const login: Login = mode === 'resume' ? existing! : { username: email, userPoolId: out.UserPoolId, password: `Aa1!${randomBytes(24).toString('base64url')}` };
  const requestFile = `.local/user-request-${randomUUID()}.json`;
  const call = (operation: string, body: unknown) => {
    writePrivate(requestFile, body);
    aws(['cognito-idp', operation, '--cli-input-json', `file://${requestFile}`]);
  };
  try {
    const result = provisionUser(mode, login, {
      find,
      save: value => {
        if (mode === 'reset' && existing) writePrivate(`.local/camera-login-backup-${randomUUID()}.json`, existing);
        writePrivate(file, value);
      },
      create: () => call('admin-create-user', { UserPoolId: out.UserPoolId, Username: email, MessageAction: 'SUPPRESS', UserAttributes: [{ Name: 'email', Value: email }] }),
      setPassword: password => call('admin-set-user-password', { UserPoolId: out.UserPoolId, Username: email, Password: password, Permanent: true }),
    });
    console.log(result === 'already-confirmed'
      ? 'User is already confirmed; password unchanged. Test the saved login, or use --reset if it is unusable.'
      : 'Camera login ready. Credentials saved in .local/camera-login.json (0600). No invitation email sent.');
  } finally { if (existsSync(requestFile)) unlinkSync(requestFile); }
}
try { main(); } catch (e) { console.error((e as Error).message); process.exitCode = 1; }
