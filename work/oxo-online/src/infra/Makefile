PROFILE    ?= dev-int
GITHUB_ORG  = john-aerocloud
GITHUB_REPO = claude_learning_agents
CDK_CONTEXT = -c githubOrg=$(GITHUB_ORG) -c githubRepo=$(GITHUB_REPO)
CDK_FLAGS   = --profile $(PROFILE) --require-approval never $(CDK_CONTEXT)

# S3 + CloudFront values (from cdk deploy OxoOnlineProd outputs)
S3_BUCKET           ?= oxo-online-web-817047731316-eu-west-2
CLOUDFRONT_DIST_ID  ?= E519HYABC57ZX
AWS_REGION          ?= eu-west-2
APP_BUILD_DIR       ?= ../app/build

# Prod-only: set these to enable a custom domain + ACM cert
CERT_ARN     ?=
HOSTED_ZONE  ?=
DOMAIN_NAME  ?=

ifneq ($(CERT_ARN),)
CDK_FLAGS += -c certArn=$(CERT_ARN) -c hostedZoneId=$(HOSTED_ZONE) -c domainName=$(DOMAIN_NAME)
endif

.PHONY: bootstrap deploy-oidc deploy diff destroy build deploy-app

## Infra targets

bootstrap:
	npx cdk bootstrap aws://$(shell aws sts get-caller-identity --profile $(PROFILE) --query Account --output text)/eu-west-2 \
	  --profile $(PROFILE) --trust $(shell aws sts get-caller-identity --profile $(PROFILE) --query Account --output text) \
	  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess

deploy-oidc:
	npx cdk deploy OxoOnlineOidcStack $(CDK_FLAGS)

deploy:
	npx cdk deploy OxoOnlineProd $(CDK_FLAGS)

deploy-all: deploy-oidc deploy

diff:
	npx cdk diff OxoOnlineProd $(CDK_FLAGS)

destroy:
	npx cdk destroy OxoOnlineProd $(CDK_FLAGS)

build:
	npm run build

## App deploy targets (manual — mirrors what the GitHub Actions pipeline does)

deploy-app: deploy-app-html deploy-app-assets deploy-app-other invalidate

deploy-app-html:
	aws s3 sync $(APP_BUILD_DIR)/ s3://$(S3_BUCKET)/ \
	  --profile $(PROFILE) --region $(AWS_REGION) \
	  --exclude "*" --include "*.html" \
	  --cache-control "no-cache, no-store, must-revalidate" \
	  --delete

deploy-app-assets:
	aws s3 sync $(APP_BUILD_DIR)/static/ s3://$(S3_BUCKET)/static/ \
	  --profile $(PROFILE) --region $(AWS_REGION) \
	  --cache-control "public, max-age=31536000, immutable"

deploy-app-other:
	aws s3 sync $(APP_BUILD_DIR)/ s3://$(S3_BUCKET)/ \
	  --profile $(PROFILE) --region $(AWS_REGION) \
	  --exclude "*.html" --exclude "static/*" \
	  --cache-control "public, max-age=86400"

invalidate:
	aws cloudfront create-invalidation \
	  --profile $(PROFILE) \
	  --distribution-id $(CLOUDFRONT_DIST_ID) \
	  --paths "/*"
