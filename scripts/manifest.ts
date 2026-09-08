import type { Config } from '../lib/config';

export function creationManifest(config: Config, functionArn: string) {
  const full = manifest(config, functionArn);
  // Reserve the skill ID before Lambda permission can be scoped to it.
  return { manifest: { ...full.manifest, apis: { smartHome: { protocolVersion: '3' } } } };
}

export function manifest(config: Config, functionArn: string) {
  if (!/^arn:aws:lambda:us-west-2:\d{12}:function:/.test(functionArn)) throw new Error('Australian Alexa endpoint must be a us-west-2 Lambda ARN.');
  return {
    manifest: {
      manifestVersion: '1.0',
      publishingInformation: {
        locales: {
          'en-AU': {
            name: config.skillName,
            summary: 'View your personal Scrypted cameras on Alexa.',
            description: 'Connect a personal Scrypted server and view selected cameras on a compatible Alexa display. Requires Scrypted, its WebRTC plugin, and this companion bridge.',
            examplePhrases: ['Alexa, show the front door camera.'],
            keywords: ['camera', 'Scrypted'],
          },
        },
        isAvailableWorldwide: false,
        distributionCountries: ['AU'],
        category: 'SMART_HOME',
        testingInstructions: 'Personal development skill. Link an administrator-created Cognito account and discover cameras selected in the companion Scrypted plugin.',
      },
      apis: { smartHome: { protocolVersion: '3', endpoint: { uri: functionArn }, regions: { FE: { endpoint: { uri: functionArn } } } } },
      // No Send Alexa Events permission: all RTC responses are synchronous.
    },
  };
}
