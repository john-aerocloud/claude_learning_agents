# ROOT Makefile — AGENT OPERATIONS (process v17 §36 / v23 §33, IMP-003)
#
# Parameterised, allowlist-shaped entry points for the operations every agent
# repeats. No inline env-var assembly, no hand-built python invocations — a
# target + arguments, automatable and committed.
#
# All targets run from the project root. PROJECT defaults to work/ACTIVE.
#
# DO NOT CONFUSE with work/<project>/src/infra/Makefile — that one is
# DEPLOY-OPS only (bootstrap/deploy-oidc/deploy/diff/destroy). The agent-ops
# targets (validate/smoke/dora-record/test-*) live HERE and only here.
# Agents: per v23 §33.5 you create/extend targets here yourself when your
# role needs one — tested, documented, committed, named in your return.

PROJECT ?= $(shell cat work/ACTIVE 2>/dev/null)
APP     := work/$(PROJECT)/src/app
INFRA   := work/$(PROJECT)/src/infra
DORA    := python3 .claude/skills/dora-ledger/scripts/dora.py
AWS_PROFILE ?= $(shell cat .claude/config/aws-profile 2>/dev/null)

# --- AWS SSO login -------------------------------------------------------------
# Re-authenticate the project's SSO profile when the cached token has expired
# (symptom: any aws CLI call fails with "Token has expired and refresh failed").
# Opens the SSO browser flow for the human to approve; agents may invoke it and
# wait. Profile comes from .claude/config/aws-profile (aws-profile skill).
# make sso-login [AWS_PROFILE=dev-int]
sso-login:
	aws sso login --profile $(AWS_PROFILE)

# --- DORA ledger -------------------------------------------------------------
# make dora-record EVENT=validation_run AGENT=tester SLICE=004-create-game \
#      ITER=5 REF="<sha>:<suite>" OUTCOME=success NOTE="7/7 vs prod"
# Optional: DURATION=<seconds>
dora-record:
	$(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent $(AGENT) --event $(EVENT) \
	  $(if $(DURATION),--duration $(DURATION),) \
	  $(if $(OUTCOME),--outcome $(OUTCOME),) \
	  $(if $(REF),--ref "$(REF)",) \
	  $(if $(NOTE),--note "$(NOTE)",)

dora-compute:
	$(DORA) compute

# --- Validation & smoke (run + record in one step) ----------------------------
# make validate ITER=5 SLICE=004-create-game [PROD_URL=https://…] [AWS_PROFILE=dev-int]
# PROD_URL and AWS_PROFILE are forwarded to the playwright test runner when set.
validate:
	$(if $(PROD_URL),PROD_URL=$(PROD_URL) ,)$(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE) ,)npm --prefix $(APP) run test:validation && \
	$(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent tester --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):validation" --outcome success \
	  --note "tests/validation green via make validate" || \
	( $(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent tester --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):validation" --outcome fail \
	  --note "tests/validation FAILED via make validate" ; exit 1 )

# make smoke ITER=5 SLICE=004-create-game [PROD_URL=https://…]
# PROD_URL is forwarded to the playwright test runner when set.
smoke:
	$(if $(PROD_URL),PROD_URL=$(PROD_URL) ,)npm --prefix $(APP) run test:smoke && \
	$(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent tester --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):smoke" --outcome success \
	  --note "tests/smoke green via make smoke" || \
	( $(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent tester --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):smoke" --outcome fail \
	  --note "tests/smoke FAILED via make smoke" ; exit 1 )

# --- WAF walking-skeleton probe (s005-h1-waf Step 9) --------------------------
# Drives the deployed CloudFront global WAFv2 ACL: HTTP burst past the rate-rule
# threshold expects >=1 edge 403, then one clean POST /api/games expects 201.
# The WS half is retired with UC2 (GATE-AMEND-H1-A). Node fetch probe is §17-
# justified — WAF acts below browser-layer concerns.
# make waf-probe BASE_URL=https://d3pf3kcvzpau1x.cloudfront.net [BURST=160]
waf-probe:
	node work/$(PROJECT)/scripts/waf-burst-probe.js --base-url $(BASE_URL) \
	  $(if $(BURST),--burst $(BURST),)

# --- WAF sustained-rate probe (s005-h1-waf AC3.1) -----------------------------
# Paces >100 POST /api/games at 1 req/1.5s across ~165s. Unlike the burst probe,
# this paced pattern gives WAF's periodic evaluation cycle (every ~30s) enough
# requests in the 300s sliding window to fire the Block action.
# Called by tests/validation/slice005-h1-waf-ac3.1.spec.ts (make validate).
# Standalone invocation for operator use (NOT the primary entry point for UC3):
# make waf-sustained BASE_URL=https://d3pf3kcvzpau1x.cloudfront.net [COUNT=110] [PACE_MS=1500]
waf-sustained:
	node work/$(PROJECT)/scripts/waf-sustained-probe.js --base-url $(BASE_URL) \
	  $(if $(COUNT),--count $(COUNT),) \
	  $(if $(PACE_MS),--pace-ms $(PACE_MS),)

# --- WS $connect authorizer walking-skeleton probe (s005-h2 T6, DEFECT-H2-002) -
# Drives the deployed REQUEST authorizer over the FULL four-path T6 acceptance in
# one asserting run: mint wsToken+code, then assert host-wsToken OPENS, guest-code
# OPENS, no-credential CLOSES, garbage-token CLOSES. Exits nonzero on any mismatch
# and records a dora row. LIVE-ENDPOINT probe — deliberately NOT in test-infra/
# test-app (those run offline). Node WS/fetch is §17-justified: the authorizer
# gate acts at the API-GW upgrade, below browser-layer concerns. Post-deploy gate,
# peer to waf-probe.
# make ws-skeleton ITER=8 SLICE=s005-h2-connect-auth \
#   API_BASE=https://d3pf3kcvzpau1x.cloudfront.net \
#   WS_URL=wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com/prod
ws-skeleton:
	node work/$(PROJECT)/scripts/ws-skeleton-probe.js --api-base $(API_BASE) --ws-url $(WS_URL) && \
	$(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent engineer --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):ws-skeleton" --outcome success \
	  --note "T6 WS \$$connect authorizer probe green (4/4 paths) via make ws-skeleton" || \
	( $(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent engineer --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):ws-skeleton" --outcome fail \
	  --note "T6 WS \$$connect authorizer probe FAILED via make ws-skeleton" ; exit 1 )

# --- App / infra test entry points --------------------------------------------
test-app:
	npm --prefix $(APP) run test:run

lint-app:
	npm --prefix $(APP) run lint

build-app:
	npm --prefix $(APP) run build

test-infra:
	npm --prefix $(INFRA) test

test-lambda:
	npm --prefix work/$(PROJECT)/src/lambda test

# Synth all stacks with the project-pinned CDK (not a global npx install).
# STACKS optional: make synth-infra STACKS="OxoGameProd"
# githubOrg/githubRepo go as -c context flags per process §19 (GITHUB_ env prefix is reserved).
GH_ORG  ?= john-aerocloud
GH_REPO ?= claude_learning_agents
synth-infra:
	npm --prefix $(INFRA) run cdk -- synth $(STACKS) --quiet \
	  -c githubOrg=$(GH_ORG) -c githubRepo=$(GH_REPO)

.PHONY: sso-login dora-record dora-compute validate smoke waf-probe waf-sustained ws-skeleton test-app lint-app build-app test-infra synth-infra
