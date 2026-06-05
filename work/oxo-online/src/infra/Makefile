PROFILE    ?= dev-int
GITHUB_ORG  = john-aerocloud
GITHUB_REPO = claude_learning_agents
CDK_CONTEXT = -c githubOrg=$(GITHUB_ORG) -c githubRepo=$(GITHUB_REPO)
CDK_FLAGS   = --profile $(PROFILE) --require-approval never $(CDK_CONTEXT)

# Prod-only: set these to enable a custom domain + ACM cert
CERT_ARN     ?=
HOSTED_ZONE  ?=
DOMAIN_NAME  ?=

ifneq ($(CERT_ARN),)
CDK_FLAGS += -c certArn=$(CERT_ARN) -c hostedZoneId=$(HOSTED_ZONE) -c domainName=$(DOMAIN_NAME)
endif

.PHONY: bootstrap deploy-oidc deploy diff destroy build

bootstrap:
	npx cdk bootstrap aws://$(shell aws sts get-caller-identity --profile $(PROFILE) --query Account --output text)/eu-west-2 --profile $(PROFILE)

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
