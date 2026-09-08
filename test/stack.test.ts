import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { CameraStack } from '../lib/stack';
import { creationManifest, manifest } from '../scripts/manifest';
import { validateEndpoint } from '../lib/config';

const config = { skillName: 'Test Cameras', scryptedEndpoint: 'https://bridge.example/endpoint/scrypted-alexa-au/public/', alexaRedirectUrls: ['https://alexa.amazon.co.jp/api/skill/link/VENDOR'], skillId: 'amzn1.ask.skill.test' };
test('stack restricts invocation, sign-up and secret access; OAuth is code grant', () => {
  const stack = new CameraStack(new App(), 'Test', { env: { account: '123456789012', region: 'us-west-2' }, config });
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::Lambda::Permission', { Principal: 'alexa-connectedhome.amazon.com', EventSourceToken: config.skillId, Action: 'lambda:InvokeFunction' });
  template.hasResourceProperties('AWS::Lambda::Function', { Runtime: 'nodejs22.x', Timeout: 8 });
  template.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true } });
  template.hasResourceProperties('AWS::Cognito::UserPoolClient', { GenerateSecret: true, AllowedOAuthFlows: ['code'], AllowedOAuthScopes: Match.arrayWith([{ 'Fn::Join': ['', [Match.objectLike({ Ref: Match.anyValue() }), '/access']] }]), CallbackURLs: config.alexaRedirectUrls });
  template.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', { Identifier: 'cameras', Scopes: [{ ScopeName: 'access', ScopeDescription: Match.anyValue() }] });
  template.hasResourceProperties('AWS::IAM::Policy', { PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: Match.arrayWith(['secretsmanager:GetSecretValue']), Resource: Match.objectLike({ Ref: Match.anyValue() }) })]) } });
  const json = template.toJSON();
  assert.equal(JSON.stringify(json.Outputs).includes('ClientSecret'), false);
  const m = manifest(config, 'arn:aws:lambda:us-west-2:123456789012:function:relay');
  const initial = creationManifest(config, 'arn:aws:lambda:us-west-2:123456789012:function:relay');
  assert.deepEqual(initial.manifest.apis.smartHome, { protocolVersion: '3' });
  assert.ok(m.manifest.publishingInformation.locales['en-AU']);
  assert.deepEqual(m.manifest.publishingInformation.distributionCountries, ['AU']);
  assert.equal(m.manifest.apis.smartHome.regions.FE.endpoint.uri, m.manifest.apis.smartHome.endpoint.uri);
  assert.throws(() => manifest(config, 'arn:aws:lambda:ap-southeast-2:123456789012:function:relay'));
});

test('endpoint configuration rejects insecure URLs and embedded credentials', () => {
  for (const url of ['http://bridge.example/public/', 'https://user:password@bridge.example/public/', 'https://bridge.example/public/?token=secret', 'https://bridge.example/admin']) assert.throws(() => validateEndpoint(url));
  assert.equal(validateEndpoint(config.scryptedEndpoint), config.scryptedEndpoint);
});
