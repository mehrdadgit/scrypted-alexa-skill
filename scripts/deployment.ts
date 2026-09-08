import { aws } from './aws';
import { writePrivate } from './io';

export function readDeployment(): Record<string, string> {
  const identity = aws(['sts', 'get-caller-identity']);
  const stack = aws(['cloudformation', 'describe-stacks', '--stack-name', 'ScryptedAlexaAu']).Stacks?.[0];
  if (!stack || !['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'].includes(stack.StackStatus))
    throw new Error('Stack is not ready. Inspect CloudFormation events.');
  const out: Record<string, string> = Object.fromEntries((stack.Outputs || []).map((v: any) => [v.OutputKey, v.OutputValue]));
  if (!out.FunctionArn?.startsWith(`arn:aws:lambda:us-west-2:${identity.Account}:function:`)) throw new Error('Stack/account mismatch. Check AWS_PROFILE.');
  for (const key of ['UserPoolId', 'UserPoolClientId', 'AuthorizationUrl', 'TokenUrl', 'BridgeSecretArn', 'ScryptedEndpoint', 'LogGroupName'])
    if (!out[key]) throw new Error(`Stack output ${key} missing.`);
  return out;
}
export function saveDeployment(out: Record<string, string>) {
  writePrivate('.local/cdk-outputs.json', { ScryptedAlexaAu: out });
}
