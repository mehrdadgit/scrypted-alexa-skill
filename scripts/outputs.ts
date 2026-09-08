import { readDeployment, saveDeployment } from './deployment';
try {
  saveDeployment(readDeployment());
  console.log('Refreshed .local/cdk-outputs.json from the selected AWS account in us-west-2.');
} catch (e) { console.error((e as Error).message); process.exitCode = 1; }
