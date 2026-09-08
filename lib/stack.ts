import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { Config } from './config';
import { resolve } from 'node:path';

export class CameraStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { config: Config }) {
    super(scope, id, props);
    const pool = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: { minLength: 14, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const cameraScope = new cognito.ResourceServerScope({ scopeName: 'access', scopeDescription: 'View the cameras selected in Scrypted' });
    const resource = pool.addResourceServer('CameraScope', { identifier: 'cameras', scopes: [cameraScope] });
    const client = pool.addClient('AlexaClient', {
      generateSecret: true,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(15),
      refreshTokenValidity: Duration.days(365),
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.resourceServer(resource, cameraScope)],
        callbackUrls: props.config.alexaRedirectUrls,
      },
    });
    const domain = pool.addDomain('Login', {
      cognitoDomain: { domainPrefix: `scrypted-au-${this.account}-${this.region}` },
    });
    const secret = new secrets.Secret(this, 'BridgeSecret', {
      description: 'Shared bearer key for the personal Scrypted Alexa companion plugin',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const logGroup = new logs.LogGroup(this, 'RelayLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const relay = new NodejsFunction(this, 'Relay', {
      entry: resolve('lambda/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(8),
      logGroup,
      environment: {
        USER_POOL_ID: pool.userPoolId,
        CLIENT_ID: client.userPoolClientId,
        SCRYPTED_ENDPOINT: props.config.scryptedEndpoint,
        BRIDGE_SECRET_ARN: secret.secretArn,
      },
      bundling: { minify: true, sourceMap: true, externalModules: [] },
    });
    secret.grantRead(relay);
    // No unrestricted Alexa invocation during the initial bootstrap deployment.
    if (props.config.skillId) new lambda.CfnPermission(this, 'AlexaPermission', {
      action: 'lambda:InvokeFunction',
      functionName: relay.functionName,
      principal: 'alexa-connectedhome.amazon.com',
      eventSourceToken: props.config.skillId,
    });
    const outputs: Record<string, string> = {
      FunctionArn: relay.functionArn,
      UserPoolId: pool.userPoolId,
      UserPoolClientId: client.userPoolClientId,
      AuthorizationUrl: `${domain.baseUrl()}/oauth2/authorize`,
      TokenUrl: `${domain.baseUrl()}/oauth2/token`,
      BridgeSecretArn: secret.secretArn,
      ScryptedEndpoint: props.config.scryptedEndpoint,
      LogGroupName: logGroup.logGroupName,
    };
    for (const [name, value] of Object.entries(outputs)) new CfnOutput(this, name, { value });
  }
}
