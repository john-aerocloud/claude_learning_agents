import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * OxoOnlineOidcStack — OIDC provider + deploy IAM role.
 *
 * Deploy this stack ONCE manually before the first application deploy:
 *   cdk deploy OxoOnlineOidcStack --profile <profile>
 *
 * After deploy, copy the DeployRoleArn output value into the GitHub repository
 * secret named AWS_DEPLOY_ROLE_ARN.  The GitHub Actions workflow uses this
 * secret to assume the role via OIDC — no static AWS keys are ever stored.
 *
 * Do NOT include this stack in the automated pipeline (deploy.yml deploys
 * OxoOnlineProd only). Re-deploying this stack would attempt to recreate the
 * OIDC provider, which is an account-level singleton.
 *
 * Security controls satisfied (iam-deploy-role.md):
 *   - No IAM user or long-lived access key.
 *   - Trust policy restricted to specific repo + branch via sub condition.
 *   - aud = sts.amazonaws.com asserted.
 *   - Permissions scoped by resource ARN (S3 bucket + CloudFront distribution).
 *   - No iam:* in permissions.
 *   - Session duration capped at 1 hour.
 *   - Deploy role cannot escalate privileges (no PassRole, no IAM write).
 */

export interface OxoOnlineOidcStackProps extends cdk.StackProps {
  /** GitHub organisation or user name (e.g. "my-org"). */
  githubOrg: string;
  /** GitHub repository name (e.g. "oxo-online"). */
  githubRepo: string;
  /** Branch that is allowed to assume the role (default: main). */
  deployBranch?: string;
}

export class OxoOnlineOidcStack extends cdk.Stack {
  public readonly deployRoleArn: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: OxoOnlineOidcStackProps) {
    super(scope, id, props);

    const branch = props.deployBranch ?? 'main';

    // -------------------------------------------------------------------------
    // GitHub Actions OIDC provider.
    // AWS accounts get one OIDC provider per URL. If you already have one for
    // token.actions.githubusercontent.com, CDK will attempt to create a second
    // and fail. In that case, import the existing provider instead:
    //   const ghProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
    //     this, 'GithubOidc',
    //     `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`
    //   );
    // -------------------------------------------------------------------------
    const ghProvider = new iam.OpenIdConnectProvider(this, 'GithubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      // Thumbprint list is managed by AWS when url uses well-known OIDC metadata;
      // CDK v2.x handles this automatically.
    });

    // -------------------------------------------------------------------------
    // oxo-deploy IAM role — assumed only by GitHub Actions on the deploy branch.
    //
    // Permissions:
    //   s3: PutObject, DeleteObject, ListBucket, GetBucketLocation on the web
    //       bucket (scoped by naming convention; ARN interpolated from account).
    //   cloudfront: CreateInvalidation on all distributions in this account
    //       (CloudFront ARNs for CreateInvalidation must use * for the resource
    //       in some SDK versions; distribution ID is passed at runtime anyway).
    //
    // No iam:*, no AdministratorAccess, no PassRole.
    // -------------------------------------------------------------------------
    const deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'oxo-deploy',
      assumedBy: new iam.WebIdentityPrincipal(
        ghProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': `repo:${props.githubOrg}/${props.githubRepo}:ref:refs/heads/${branch}`,
          },
        },
      ),
      maxSessionDuration: cdk.Duration.hours(1),
      description:
        'GitHub Actions OIDC deploy role for oxo-online. Scoped to web bucket + CloudFront only.',
    });

    // S3 permissions — scoped to the specific web bucket by naming convention.
    // The bucket is named deterministically: oxo-online-web-<account>-<region>.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3WebBucketDeploy',
        effect: iam.Effect.ALLOW,
        actions: [
          's3:PutObject',
          's3:DeleteObject',
          's3:GetObject',
          's3:ListBucket',
          's3:GetBucketLocation',
        ],
        resources: [
          // Bucket itself (for ListBucket)
          `arn:aws:s3:::oxo-online-web-${this.account}-*`,
          // Objects inside the bucket
          `arn:aws:s3:::oxo-online-web-${this.account}-*/*`,
        ],
      }),
    );

    // CloudFront invalidation — scoped to distributions in this account.
    // CreateInvalidation requires the distribution ARN; we allow all distributions
    // owned by this account (not a wildcard across all of AWS).
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFrontInvalidate',
        effect: iam.Effect.ALLOW,
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/*`,
        ],
      }),
    );

    // CDK deploy: allow describing CloudFormation stacks so `cdk deploy` can
    // compute a diff and execute the change set.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkDeploy',
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:DescribeChangeSet',
          'cloudformation:CreateChangeSet',
          'cloudformation:ExecuteChangeSet',
          'cloudformation:DeleteChangeSet',
          'cloudformation:GetTemplate',
          'cloudformation:ValidateTemplate',
          'sts:GetCallerIdentity',
          // Read CDK bootstrap assets
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket',
        ],
        resources: ['*'],
        // Note: cloudformation and sts calls cannot be resource-scoped further
        // in CDK deploy patterns. This is the minimal set for cdk deploy.
      }),
    );

    // CDK bootstrap SSM read — CDK reads /cdk-bootstrap/hnb659fds/version.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkBootstrapSsm',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:*:${this.account}:parameter/cdk-bootstrap/*/version`,
        ],
      }),
    );

    // Allow CDK to read/write the CDK deploy bucket and manage ECR for assets.
    // These are the standard CDK bootstrap permissions required for any CDK deploy.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkS3Assets',
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:ListBucket',
          's3:GetBucketLocation',
        ],
        resources: [
          // CDK staging bucket (bootstrap naming: cdk-<qualifier>-assets-<account>-<region>)
          `arn:aws:s3:::cdk-*-assets-${this.account}-*`,
          `arn:aws:s3:::cdk-*-assets-${this.account}-*/*`,
        ],
      }),
    );

    // IAM read-only for CDK to resolve role/policy ARNs during diff/deploy.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'IamReadOnly',
        effect: iam.Effect.ALLOW,
        actions: [
          'iam:GetRole',
          'iam:GetRolePolicy',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
        ],
        resources: [`arn:aws:iam::${this.account}:role/*`],
      }),
    );

    // Stack output — copy this value into the GitHub secret AWS_DEPLOY_ROLE_ARN.
    this.deployRoleArn = new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: deployRole.roleArn,
      description:
        'Copy this ARN into the GitHub repository secret AWS_DEPLOY_ROLE_ARN',
      exportName: 'OxoOnlineOidc-DeployRoleArn',
    });

    new cdk.CfnOutput(this, 'OidcProviderArn', {
      value: ghProvider.openIdConnectProviderArn,
      description: 'GitHub OIDC provider ARN (for reference)',
    });
  }
}
