import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * IMPORTANT: The ACM certificate (certArn) MUST be pre-created in us-east-1
 * (N. Virginia) regardless of which region the rest of the stack is deployed in.
 * CloudFront requires certificates in us-east-1. Create the cert manually in
 * the AWS console or via a separate CDK stack deployed to us-east-1, validate
 * it via DNS, then pass its ARN here.
 */

export interface OxoOnlineShellStackProps extends cdk.StackProps {
  /** ARN of the ACM certificate — must be in us-east-1. Omit for dev (auto *.cloudfront.net). */
  certArn?: string;
  /** Route 53 hosted zone ID for the domain. Omit for dev. */
  hostedZoneId?: string;
  /** Domain name served (e.g. oxo.example.com). Omit for dev. */
  domainName?: string;
}

export class OxoOnlineShellStack extends cdk.Stack {
  /** S3 bucket name — exported so GitHub Actions can sync to it. */
  public readonly webBucketName: cdk.CfnOutput;
  /** CloudFront distribution ID — exported for invalidation step. */
  public readonly distributionId: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: OxoOnlineShellStackProps) {
    super(scope, id, props);

    // -------------------------------------------------------------------------
    // S3 web bucket — private; only CloudFront OAC may read objects.
    //
    // Security controls satisfied:
    //   - Block Public Access: all four settings enabled (CDK default for Bucket)
    //   - SSE-S3 enabled
    //   - Versioning enabled (rollback: re-sync prior artifacts + invalidate)
    //   - No write permission for any principal except oxo-deploy role (policy below)
    //   - Bucket policy denies aws:SecureTransport=false (enforceSSL)
    // -------------------------------------------------------------------------
    const webBucket = new s3.Bucket(this, 'WebBucket', {
      bucketName: `oxo-online-web-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // CloudFront access logging bucket — locked down; no public access.
    const logBucket = new s3.Bucket(this, 'CfLogBucket', {
      bucketName: `oxo-online-cf-logs-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -------------------------------------------------------------------------
    // CloudFront Origin Access Control (OAC) — modern replacement for OAI.
    // Only this OAC is granted s3:GetObject; all other principals are denied.
    // -------------------------------------------------------------------------
    const oac = new cloudfront.S3OriginAccessControl(this, 'OAC', {
      signing: cloudfront.Signing.SIGV4_NO_OVERRIDE,
    });

    // Grant CloudFront OAC read access to the bucket.
    // CDK's S3BucketOrigin.withOriginAccessControl attaches the bucket policy
    // statement automatically, but we add an explicit deny for non-OAC callers
    // after the distribution is created (below).
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(webBucket, {
      originAccessControl: oac,
    });

    // -------------------------------------------------------------------------
    // Security response headers policy:
    //   - HSTS: max-age 2 years, includeSubDomains
    //   - Content-Security-Policy: strict default; tighten per slice
    //   - X-Frame-Options: DENY
    //   - X-Content-Type-Options: nosniff
    //   - Referrer-Policy: same-origin
    // -------------------------------------------------------------------------
    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      'SecHeaders',
      {
        securityHeadersBehavior: {
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.days(730),
            includeSubdomains: true,
            preload: true,
            override: true,
          },
          contentSecurityPolicy: {
            // connect-src: 'self' covers the same-origin /api/* fetch (routed
            // through CloudFront). The online game's WebSocket targets the
            // execute-api WSS endpoint, a DIFFERENT origin, so it MUST be
            // allow-listed or the browser silently blocks the connection
            // (DEFECT-005-001-R2 second root cause — pairing could never
            // connect). Scoped to this region's execute-api WSS hosts only
            // (region-scoped wildcard, not a blanket wss:*), which keeps the
            // policy tight without taking a new cross-stack import (the s004
            // export-ordering lesson). script/style/img/font stay locked down.
            contentSecurityPolicy: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss://*.execute-api.${this.region}.amazonaws.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
            override: true,
          },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          contentTypeOptions: { override: true },
          referrerPolicy: {
            referrerPolicy: cloudfront.HeadersReferrerPolicy.SAME_ORIGIN,
            override: true,
          },
        },
      },
    );

    const cert = props.certArn
      ? acm.Certificate.fromCertificateArn(this, 'Cert', props.certArn)
      : undefined;

    // -------------------------------------------------------------------------
    // CloudFront distribution.
    //
    // Security controls satisfied:
    //   - viewerProtocolPolicy: REDIRECT_TO_HTTPS
    //   - minimumProtocolVersion: TLS_V1_2_2021
    //   - Origin: OAC-authenticated S3 (not public website endpoint)
    //   - defaultRootObject: index.html
    //   - SPA error routing: 403 and 404 → /index.html, HTTP 200
    //   - Response headers policy: HSTS, CSP, X-Frame-Options, X-Content-Type-Options
    //   - Access logging enabled to separate log bucket
    //   - WAF: deferred to Chunk 4 per delta 001
    // -------------------------------------------------------------------------
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        // 403 from S3 (key not found when Block Public Access is on) → SPA
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        // 404 → SPA (belt-and-suspenders; S3 serves 403 for missing keys)
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      ...(props.domainName && cert
        ? { domainNames: [props.domainName], certificate: cert }
        : {}),
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enableLogging: true,
      logBucket,
      logFilePrefix: 'cloudfront/',
      comment: 'oxo-online SPA — slice 001',
    });

    // -------------------------------------------------------------------------
    // /api/* behaviour — routes API calls to the OxoGameProd HTTP API.
    //
    // The HTTP API invoke URL is exported by OxoGameProd as a CfnOutput; we
    // import it here (CloudFormation enforces OxoGameProd deploys first).
    // Security controls satisfied (delta 004, T2):
    //   - CachingDisabled: per-request responses are never cached.
    //   - HTTPS-only to the origin (TLS 1.2+ at the API).
    //   - viewerProtocolPolicy redirect-to-HTTPS (no plaintext from viewers).
    //   - ALLOW_ALL methods so POST /api/games reaches the Lambda.
    //   - AllViewerExceptHostHeader forwards body/method/headers the API needs.
    // The SPA path stays same-origin, so the CSP connect-src 'self' already
    // permits the /api/games fetch — no CSP change required.
    // -------------------------------------------------------------------------
    const httpApiEndpoint = cdk.Fn.importValue('OxoGameProd-HttpApiEndpoint');
    const apiOrigin = new origins.HttpOrigin(
      // apiEndpoint is "https://<id>.execute-api.<region>.amazonaws.com";
      // CloudFront origins take the domain only — select the host portion.
      cdk.Fn.select(2, cdk.Fn.split('/', httpApiEndpoint)),
      {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        originPath: '',
      },
    );

    distribution.addBehavior('/api/*', apiOrigin, {
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      originRequestPolicy:
        cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy,
    });

    // -------------------------------------------------------------------------
    // Deny direct access to the S3 bucket from any principal other than the OAC.
    // CDK's OAC origin adds the Allow statement; this explicit Deny makes the
    // policy defence-in-depth even if the Allow were removed.
    // -------------------------------------------------------------------------
    webBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyNonCloudFrontRead',
        effect: iam.Effect.DENY,
        principals: [new iam.StarPrincipal()],
        actions: ['s3:GetObject'],
        resources: [webBucket.arnForObjects('*')],
        conditions: {
          StringNotEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      }),
    );

    // Grant the oxo-deploy role write access to the bucket.
    // The role ARN is resolved at deploy time from the OIDC stack output.
    // We reference it by naming convention; this avoids a cross-stack reference
    // that would require both stacks to deploy in lockstep.
    const deployRoleName = 'oxo-deploy';
    webBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowDeployRoleWrite',
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.ArnPrincipal(
            `arn:aws:iam::${this.account}:role/${deployRoleName}`,
          ),
        ],
        actions: [
          's3:PutObject',
          's3:DeleteObject',
          's3:ListBucket',
          's3:GetBucketLocation',
        ],
        resources: [webBucket.bucketArn, webBucket.arnForObjects('*')],
      }),
    );

    // Route 53 alias record — only created when a custom domain is configured.
    if (props.hostedZoneId && props.domainName) {
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        'HostedZone',
        {
          hostedZoneId: props.hostedZoneId,
          zoneName: props.domainName.split('.').slice(-2).join('.'),
        },
      );

      new route53.ARecord(this, 'AliasRecord', {
        zone: hostedZone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(
          new route53targets.CloudFrontTarget(distribution),
        ),
      });
    }

    // -------------------------------------------------------------------------
    // Stack outputs — consumed by GitHub Actions as environment variables.
    // -------------------------------------------------------------------------
    this.webBucketName = new cdk.CfnOutput(this, 'WebBucketName', {
      value: webBucket.bucketName,
      description: 'S3 bucket name for GitHub Actions s3 sync',
      exportName: 'OxoOnlineProd-WebBucketName',
    });

    this.distributionId = new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID for cache invalidation',
      exportName: 'OxoOnlineProd-DistributionId',
    });

    new cdk.CfnOutput(this, 'SiteUrl', {
      value: props.domainName
        ? `https://${props.domainName}`
        : `https://${distribution.distributionDomainName}`,
      description: 'Site URL',
    });
  }
}
