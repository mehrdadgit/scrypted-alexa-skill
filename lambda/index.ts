import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createHandler } from './relay';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  clientId: process.env.CLIENT_ID!,
  tokenUse: 'access',
});
const secrets = new SecretsManagerClient({ maxAttempts: 2 });
let cached: { value: string; expires: number } | undefined;

export const handler = createHandler({
  verify: token => verifier.verify(token),
  endpoint: process.env.SCRYPTED_ENDPOINT!,
  fetch,
  getSecret: async () => {
    if (cached && cached.expires > Date.now()) return cached.value;
    const result = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.BRIDGE_SECRET_ARN! }), { abortSignal: AbortSignal.timeout(1000) });
    if (!result.SecretString) throw new Error('Bridge secret missing');
    cached = { value: result.SecretString, expires: Date.now() + 60_000 };
    return cached.value;
  },
});
