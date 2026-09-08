# AWS and Alexa accounts

Each household deploys its own backend and private Alexa development skill. You need an AWS account with billing enabled and an Amazon Developer account using the same Amazon login as the Alexa devices. These are separate account systems. This project currently supports Australia (`en-AU`, `FE`, `us-west-2`) only. It does not publish a skill to the store.

## Install and authenticate the CLIs

Install [Node.js](https://nodejs.org/en/download) 22 or newer and [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html). The development commands target macOS or Linux; on Windows use WSL2 with network access to Scrypted. Native Windows is not verified. The Scrypted server can be a different machine; it does not need this repository's development dependencies.

If your organization/account has IAM Identity Center configured, create a profile and sign in:

```sh
aws configure sso --profile camera-deploy
aws sso login --profile camera-deploy
```

If you use an IAM user's access keys instead:

```sh
aws configure --profile camera-deploy
```

Enter your credentials interactively, select `us-west-2` and JSON output. Use an IAM identity, not root access keys. Credentials live in the AWS CLI's configuration outside the repository; never put them in `.env.local`. An existing authenticated profile is equally suitable. Verify:

```sh
aws sts get-caller-identity --profile camera-deploy
```

Set `AWS_PROFILE=camera-deploy` in `.env.local`. The returned account must be the one where you intend to deploy and pay for the resources.

## Deployment permissions

The deployment identity needs permissions for CDK bootstrapping and CloudFormation deployment. The simplest personal-account setup uses an administrator deployment identity. This is a powerful setup identity, not the Lambda runtime identity. Organizations should have an administrator bootstrap the account and provide an approved deployment role instead.

Bootstrapping creates IAM roles/policies, an S3 asset bucket/policy, ECR repository and SSM parameter through CloudFormation. Deploying the application creates Lambda, IAM, Cognito, Secrets Manager and CloudWatch Logs resources, including role passing. CDK's standard CloudFormation execution role normally has AdministratorAccess; do not treat the bootstrap stack as least privilege. See [CDK bootstrapping permissions](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html). Restrictive organizational policies, permissions boundaries and SCPs may require administrator changes; this project does not provide a universal least-privilege deployment policy.

Post-deployment helpers also require access to:

- CloudFormation stack descriptions and outputs; STS identity lookup.
- Cognito client inspection, user inspection/creation and permanent password setting.
- Secrets Manager secret reads (and secret writes for manual rotation).
- Lambda policy inspection and invocation for diagnostics.
- CloudWatch Logs reads for troubleshooting.

The deployed Lambda role is restricted separately: it can write its logs and read its bridge secret. Alexa invocation permission is restricted to the specific generated skill ID.

## Alexa developer setup

Register at the [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask) and complete account setup. From the project, after `npm ci` and `.env.local` setup:

```sh
npm run ask -- configure
npm run ask -- smapi get-vendor-list
```

Use your Alexa device's Amazon account in the browser. If ASK offers AWS/Lambda hosting configuration, CDK handles hosting here; you do not need an ASK-hosted skill. Select the intended ASK profile and set `ASK_PROFILE` accordingly. Copy the intended vendor ID to `ALEXA_VENDOR_ID`. If multiple vendors are available, verify the selected vendor/profile before creating the skill.

The README explains the two-stage creation: reserve the skill ID, deploy its Lambda permission, then attach endpoints. Enable the development skill from that same Amazon account. Sharing this repository does not enable your private skill for other users; they must create their own.

## Costs and deployment scope

There is one application stack named `ScryptedAlexaAu` per account/region, and one shared bootstrap stack `CDKToolkit`. Multiple independent installations in the same account/region require code changes to stack/domain names and helper output handling. Ordinary deployments from another checkout with the same configuration update the same stack.

Usage can incur Lambda, Cognito, Secrets Manager, CloudWatch and deployment asset storage charges. Free-tier eligibility depends on the account; do not assume this deployment is free. Review [AWS pricing](https://aws.amazon.com/pricing/) and configure a billing budget. Cloudflare/domain and any external TURN costs are separate. CDK does not deploy a TURN server, EC2 instance or NAT gateway for this project.
