import { App } from 'aws-cdk-lib';
import { CameraStack } from '../lib/stack';
import { loadConfig } from '../lib/config';

const app = new App();
new CameraStack(app, 'ScryptedAlexaAu', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-west-2' },
  config: loadConfig(),
});
