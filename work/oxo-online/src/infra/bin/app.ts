#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OxoOnlineShellStack } from '../lib/oxo-online-shell-stack';
import { OxoOnlineOidcStack } from '../lib/oxo-online-oidc-stack';
import { OxoGameStack } from '../lib/game-stack';
import { OxoOnlineWafUsEast1Stack } from '../lib/waf-us-east-1-stack';

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
 * Stack deploy order:
 *   1. cdk deploy OxoOnlineOidcStack  (one-time: creates OIDC provider + deploy roles)
 *      Copy DeployRoleArn → GitHub secret OXO_ONLINE_DEPLOY_ROLE_ARN.
 *      Copy InfraDeployRoleArn → GitHub secret OXO_ONLINE_INFRA_DEPLOY_ROLE_ARN.
 *   2. cdk deploy OxoGameProd         (every subsequent infra deploy — must be first)
 *   3. cdk deploy OxoOnlineProd       (consumes OxoGameProd CfnOutput for /api/* origin)
 *
 * OxoGameProd must deploy before OxoOnlineProd because OxoOnlineProd will consume
 * the HTTP API endpoint export from OxoGameProd as its /api/* CloudFront origin.
 * See work/oxo-online/src/infra/STACK_ORDER.md for the cross-stack reference pattern.
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

// s005-h1-waf — global CLOUDFRONT WebACL lives in us-east-1 (AWS hard
// constraint; region-policy exception documented in the delta). Same account,
// pinned region. Its ARN is handed to OxoOnlineProd cross-region (below).
const usEast1Env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-1',
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

// Game backend stack — deployed by GitHub Actions on every infra push.
// Must deploy BEFORE OxoOnlineProd so its HTTP API endpoint CfnOutput is
// available for the /api/* CloudFront origin in OxoOnlineProd.
new OxoGameStack(app, 'OxoGameProd', {
  env,
  tags: {
    Project: 'oxo-online',
    Env: 'prod',
    ManagedBy: 'cdk',
  },
});

// s005-h1-waf — global CLOUDFRONT WebACL stack (us-east-1). Deploys FIRST
// (STACK_ORDER.md): exports its WebACL ARN, which OxoOnlineProd imports
// cross-region to set the distribution webAclId. crossRegionReferences lets
// CDK write the ARN to an SSM parameter in us-east-1 and read it via a custom
// resource in eu-west-2 (CloudFormation has no native cross-region import).
const wafStack = new OxoOnlineWafUsEast1Stack(app, 'OxoOnlineWafUsEast1', {
  env: usEast1Env,
  crossRegionReferences: true,
  tags: {
    Project: 'oxo-online',
    Env: 'prod',
    ManagedBy: 'cdk',
  },
});

// Application (SPA hosting) stack — deployed by GitHub Actions on every push to main.
// Consumes the HTTP API endpoint from OxoGameProd to wire the /api/* origin,
// and the global WebACL ARN from OxoOnlineWafUsEast1 (cross-region) for the
// distribution webAclId (s005-h1-waf, SYNTH-CONTRACT-WAF-1).
new OxoOnlineShellStack(app, 'OxoOnlineProd', {
  env,
  crossRegionReferences: true,
  certArn,
  hostedZoneId,
  domainName,
  globalWebAclArn: wafStack.webAclArn,
  tags: {
    Project: 'oxo-online',
    Env: 'prod',
    ManagedBy: 'cdk',
  },
});
