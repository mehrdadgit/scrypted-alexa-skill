# Verification, recovery and maintenance

All commands run from the repository and load `.env.local`. Check `AWS_PROFILE`, `ASK_PROFILE` and `npm run aws -- sts get-caller-identity` before operations. Keep `.env.local`, `config.local.json` and `.local/` outside version control. Never share raw login, token, SDP or credential files in issues.

## Deployment verification

```sh
npm run diagnose
npm run diagnose -- --login
```

Both commands read the live CloudFormation outputs from the selected AWS account; they do not deploy resources. The first checks the stack, scoped Alexa trigger, development manifest, OAuth settings and authenticated Scrypted discovery **from your computer**. It reads Secrets Manager but does not print the secret.

`--login` additionally signs in with `.local/camera-login.json`, obtains a short-lived OAuth token and invokes Lambda with a discovery request. It requires `CAMERA_LOGIN_EMAIL` to match the saved login. This detects failures that affect AWS but not your LAN, including Cloudflare challenges. It uses the current Cognito client secret from AWS; `.local/account-linking.json` is not required. Temporary request/response files are created in a private directory and removed on normal completion or error. A forced process kill can leave that directory; remove any `.local/diagnose-*` leftovers locally. Normal service logs/usage charges can occur.

The login probe supports this project's classic Cognito username/password page. It does not automate MFA, external identity providers, CAPTCHA or customized login pages; a Cognito HTML change can also require an update. In those cases use Alexa's account-linking UI and Lambda logs to test. The probe never follows the final callback to Amazon, modifies the skill's linked account, or tests video. Finish by discovering cameras in Alexa and starting/stopping video on an actual display.

A successful full probe means `PASS: Authenticated AWS discovery` with at least one camera. Errors return a nonzero exit code. Zero cameras is a failure, not a successful connectivity result.

## Recover missing outputs or a failed deployment

```sh
npm run outputs:refresh
npm run aws -- cloudformation describe-stack-events --stack-name ScryptedAlexaAu --region us-west-2
```

`outputs:refresh` reconstructs `.local/cdk-outputs.json` from the existing completed stack. It does not change AWS. For expired SSO, run `npm run aws -- sso login`. For a failed CDK deployment, inspect stack events, correct the cause, then run `npm run cdk -- diff` and `npm run deploy`. Do not delete an existing stack as a routine retry. Rollback-failed stacks need CloudFormation recovery before another deployment.

## Recover skill creation

```sh
npm run skill -- status
npm run ask -- smapi list-skills-for-vendor
```

Creation is asynchronous. After `create`, wait for `SUCCEEDED` before the second CDK deployment, then update the full manifest and wait again. If status is failed, inspect `npm run skill -- status` and the saved `.local/skill-create-response.json`. Check the developer console and skill list before retrying creation. A failed initial request can return an ID without creating a usable skill.

If the skill exists, preserve its ID in `config.local.json` (or explicitly set `ALEXA_SKILL_ID`) and continue with deploy/update/link. If Amazon confirms no usable skill exists, archive the failed receipt/config privately, clear the failed ID from both configuration sources, and retry `create`. Never clear a working ID just to get past an error: that can create duplicate skills and replace the deployed invocation permission.

## Camera-login status, recovery and reset

```sh
npm run user -- --status
npm run user -- --resume
```

A normal `npm run user` saves generated credentials before creating the Cognito user. If interrupted, `--resume` checks the matching email and pool and uses that same saved password. It can create a still-missing user or finish a user in `FORCE_CHANGE_PASSWORD`. It does **not** reset an already confirmed account; if AWS completed the original operation but the CLI lost its response, the existing saved login may already work.

For an intentional password replacement:

```sh
npm run user -- --reset
```

This generates a new password, backs up any matching previous credential file under `.local/`, saves the new credentials, then sets the permanent password in Cognito. If the call fails, the saved password may not yet be active; inspect status and rerun `--reset` to generate/set a fresh password. For an existing user with no local credential file, `--reset` can generate a replacement. For a different email/pool, first back up and move the old credential file. Run only one user-provisioning command at a time.

Resetting a password is not a complete session-revocation mechanism. Existing access tokens are verified offline by Lambda and can remain accepted for their 15-minute lifetime. If credentials are compromised, disable/revoke sessions through Cognito as appropriate and relink Alexa. Recovery by email requires a verified email address; this script creates an administrator-managed account and does not send verification mail or mark ownership verified. Use this reset command when email recovery is unavailable.

## Upgrade or roll back

Back up private configuration and the Scrypted data volume. Record the currently working Git commit/version. Then:

```sh
git pull --ff-only
npm ci
npm run check
npm run cdk -- diff
npm run deploy
npm run scrypted:deploy
npm run skill -- update
npm run skill -- status
npm run diagnose -- --login
```

Wait for Alexa manifest success before testing. Run `skill -- link` when OAuth settings/client credentials changed. Do not rerun `skill -- create`, bootstrap or user creation for ordinary upgrades. Review changes affecting stored settings and retained resources before deploying. To roll back code, restore the known working revision, reinstall its lockfile dependencies, build and deploy it; reverting a Git revision alone does not revert running AWS/Scrypted code.

The SDK is pinned to 0.5.59 and has a scoped build compatibility loader. Run the packaged-plugin runtime test when updating it. The login helper currently downloads the Scrypted CLI through npx; review that tool's changes too. Dependency audit results vary over time: run `npm audit` and `npm audit --omit=dev`; do not force major dependency updates without checking CLI/SDK compatibility.

## Rotate the bridge secret

This is a coordinated change and causes a brief interruption. Pause camera playback first. In AWS Secrets Manager, open the secret identified by `BridgeSecretArn` and replace its value with a new cryptographically random raw string of at least 32 characters (64 alphanumeric characters recommended). Save as the current version. Do not use a JSON object for this secret.

```sh
npm run bridge:secret
```

Paste the newly saved `.local/bridge-secret.txt` into the companion plugin's Bridge secret setting. Wait at least one minute for Lambda's secret cache to expire, then run `npm run diagnose -- --login`. If interrupted, reconcile the plugin with the current Secrets Manager value. Do not log either secret or paste it into command arguments.

For Cognito app-client replacement, review the CDK diff, deploy, refresh outputs and run `skill -- link`; users must relink Alexa. Creating a replacement client also changes the client ID accepted by Lambda, so schedule that change. Tunnel credentials are managed separately through Cloudflare; rotate them using Cloudflare's connector procedures.

## Remove the installation

Disable/delete the personal skill in the Alexa app/developer console, remove the companion plugin and dedicated tunnel/DNS route, then:

```sh
npm run cdk -- destroy
```

The Cognito user pool (including users) and bridge secret are retained intentionally. Delete them explicitly in their AWS consoles if no longer needed; removal is irreversible. `CDKToolkit` is a separate shared deployment stack: keep it if other CDK applications use it. Review remaining S3/ECR assets and costs before deleting bootstrap infrastructure. Delete private local credentials/backups when no longer needed.
