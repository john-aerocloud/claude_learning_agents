#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OxoOnlineShellStack } from '../lib/oxo-online-shell-stack';
import { OxoOnlineOidcStack } from '../lib/oxo-online-oidc-stack';

/**
 * oxo-online CDK app entry point.
 *
 * PRE-REQUISITES:
 *   1. GitHub org/repo — GITHUB_ORG and GITHUB_REPO env vars or context
 *      (used to scope the OIDC trust policy to the exact repo+branch)
 *   2. CDK bootstrap — run once:
 *        cdk bootstrap aws://<account>/<region> --profile <profile>
 *
 * Custom domain (prod only — omit all three for dev):
 *   - certArn    ACM certificate ARN in us-east-1 (env ACM_CERT_ARN or -c certArn=...)
 *   - hostedZoneId  Route 53 hosted zone ID (env HOSTED_ZONE_ID or -c hostedZoneId=...)
 *   - domainName    e.g. oxo.example.com (env DOMAIN_NAME or -c domainName=...)
 *   Provide all three or none — partial config throws.
 *   Dev deploy omits all three and uses the auto-generated *.cloudfront.net URL.
 *
 * Stack deploy order (first time only):
 *   1. cdk deploy OxoOnlineOidcStack  (creates the OIDC provider + deploy role)
 *      Then copy the DeployRoleArn output into the GitHub secret AWS_DEPLOY_ROLE_ARN.
 *   2. cdk deploy OxoOnlineProd       (every subsequent deploy via GitHub Actions)
 */

const app = new cdk.App();

// Read config from context or environment (context wins over env).
const certArn: string =
  app.node.tryGetContext('certArn') ?? process.env.ACM_CERT_ARN ?? '';
const hostedZoneId: string =
  app.node.tryGetContext('hostedZoneId') ?? process.env.HOSTED_ZONE_ID ?? '';
const domainName: string =
  app.node.tryGetContext('domainName') ?? process.env.DOMAIN_NAME ?? '';
const githubOrg: string =
  app.node.tryGetContext('githubOrg') ?? process.env.GITHUB_ORG ?? '';
const githubRepo: string =
  app.node.tryGetContext('githubRepo') ?? process.env.GITHUB_REPO ?? '';

// All three domain params must be provided together or not at all.
const domainParamCount = [certArn, hostedZoneId, domainName].filter(Boolean).length;
if (domainParamCount > 0 && domainParamCount < 3) {
  throw new Error(
    'Provide all three or none: certArn, hostedZoneId, domainName. ' +
      'Omit all three for dev (uses auto-generated *.cloudfront.net URL).',
  );
}

if (!githubOrg || !githubRepo) {
  throw new Error(
    'Missing required context/env: githubOrg, githubRepo. ' +
      'Required to scope the OIDC trust policy.',
  );
}

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-west-2',
};

// OIDC stack — created once; not re-deployed on every app release.
// Deploy this stack manually the first time, then protect it from accidental updates.
new OxoOnlineOidcStack(app, 'OxoOnlineOidcStack', {
  env,
  githubOrg,
  githubRepo,
  deployBranch: 'main',
  tags: {
    Project: 'oxo-online',
    Env: 'prod',
    ManagedBy: 'cdk',
  },
});

// Application stack — deployed by GitHub Actions on every push to main.
new OxoOnlineShellStack(app, 'OxoOnlineProd', {
  env,
  certArn,
  hostedZoneId,
  domainName,
  tags: {
    Project: 'oxo-online',
    Env: 'prod',
    ManagedBy: 'cdk',
  },
});
