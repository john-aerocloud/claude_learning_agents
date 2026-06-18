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

# Convenience SSO logins per OagEventSource environment (v56 — human-directed):
#   local testing -> sandbox, cicd dev -> ids-dev, cicd prod -> ids-prod.
# make sso-login-sandbox | make sso-login-dev | make sso-login-prod
sso-login-sandbox:
	aws sso login --profile sandbox

sso-login-dev:
	aws sso login --profile ids-dev

sso-login-prod:
	aws sso login --profile ids-prod

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
	  $(if $(NOTE),--note "$(NOTE)",) \
	  $(if $(ITEM_ID),--item-id $(ITEM_ID),) \
	  $(if $(QUEUE),--queue $(QUEUE),)

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

# --- UI accessibility scan (ui-designer; design-ops, root Makefile only) -------
# Runs the axe/Playwright a11y + geometry specs (WCAG 2.2 AA contrast +
# visual-structural GEO assertions, ui-design.md §4) over the observatory SPA.
# The Playwright suite tags these specs @a11y; this target greps to them.
#   make a11y-observatory
a11y-observatory:
	npm --prefix work/observatory/src/app run test:a11y

build-app:
	npm --prefix $(APP) run build

# --- UC5 local stand-up (OI-28, principles/02) --------------------------------
# Start the full local move-relay stack with NO cloud creds: a local WS server
# (in-memory Games store + relay behind the SAME ports the cloud adapters
# implement) + the SPA dev server serving a local /config.js (wsUrl=ws://local,
# uc4Enabled=ON). Open two browser tabs at http://localhost:5183 to play, or run
# `make test-local` to drive the committed Playwright local suite against it.
#   make run-local
run-local:
	npm --prefix $(APP) run local

# Run the engineer's BUILD-phase Playwright browser suite against the local
# stand-up (full game to win/draw, out-of-turn reject, board lock). The suite
# starts the stand-up itself (playwright webServer), so no separate run-local
# process is needed.
#   make test-local
test-local:
	npm --prefix $(APP) run test:local

# s006 walking-skeleton (§17): drive ONE real move through the FULL deployed path
# in TWO REAL BROWSERS (Playwright, NOT a node probe — a node ws probe gives a
# FALSE GREEN below CSP/transport). Committed regression under tests/skeleton/.
# Post-deploy gate: requires the SPA deployed with uc4Enabled ON and the move
# route live in OxoGameProd.
#   make move-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
move-skeleton:
	PROD_URL=$(PROD_URL) npm --prefix $(APP) run test:skeleton

test-infra:
	npm --prefix $(INFRA) test

test-lambda:
	npm --prefix work/$(PROJECT)/src/lambda test

# Unit tests for the committed scripts (IMP-008 waf-runner-ip.js etc.) — node's
# built-in runner, no AWS. Pure logic + injected-fake-CLI orchestration only.
test-scripts:
	node --test work/$(PROJECT)/scripts/*.test.js

# --- IMP-007 impacted-tests: changed-node -> impacted-spec lookup -------------
# CROSS-PROJECT agent-ops (not per-project): diffs work/<project>/architecture/
# dependencies/*.mmd since <sha> + reads working-tree `changed`-class marks, then
# greps committed specs for @covers <node-id> tags. Emits two plain-text lists
# (IMPACTED SPECS, UNCOVERED CHANGED NODES) consumable as a tester tick-off.
# Pure git + filesystem; NO creds, NO network. Exit 2 = ADVISORY warning when a
# changed node has no covering spec (wired into the tester's flow first — NOT a
# CI gate yet). PROJECT defaults to work/ACTIVE.
#   make impacted-tests SINCE=<sha> [PROJECT=oxo-online]
impacted-tests:
	node .claude/tools/impacted-tests.js --since $(SINCE) --project $(PROJECT)

# Self-tests for the cross-project agent-ops tooling under .claude/tools/
# (IMP-007 impacted-tests.js). node's built-in runner, no creds, no network.
test-tools:
	node --test .claude/tools/*.test.js

# --- IMP-008 WAF runner-IP exclusion helpers ----------------------------------
# Add/remove a CIDR from the oxo-test-runner-ips WAFv2 IP set (us-east-1,
# CLOUDFRONT scope). The IP set is named 'oxo-test-runner-ips'; these targets
# resolve its ID from the stack output at call time so no hard-coded ID is
# needed. Both targets read-modify-write (append/remove from the current
# Addresses list — never replace — to survive parallel CI runs).
#
# make waf-runner-ip-add   CIDR=1.2.3.4/32 [AWS_PROFILE=dev-int]
# make waf-runner-ip-remove CIDR=1.2.3.4/32 [AWS_PROFILE=dev-int]
#
# For CI use from GitHub Actions (no --profile), omit AWS_PROFILE.
waf-runner-ip-add:
	node work/$(PROJECT)/scripts/waf-runner-ip.js add $(CIDR) \
	  $(if $(AWS_PROFILE),--profile $(AWS_PROFILE),)

waf-runner-ip-remove:
	node work/$(PROJECT)/scripts/waf-runner-ip.js remove $(CIDR) \
	  $(if $(AWS_PROFILE),--profile $(AWS_PROFILE),)

# --- IMP-008 smoke-ci: runner-IP exclusion + smoke + always remove -----------
# Used by tester CI runs when the CloudFront WAF rate rule would otherwise
# block the CI runner IP. Sequence: add runner IP → smoke → remove (via trap).
# CIDR is auto-detected from checkip.amazonaws.com if not supplied.
#
# make smoke-ci ITER=10 SLICE=s007-disconnect [PROD_URL=https://…] [AWS_PROFILE=dev-int]
smoke-ci:
	@RUNNER_IP=$$(curl -s https://checkip.amazonaws.com)/32 && \
	  echo "Runner CIDR: $$RUNNER_IP" && \
	  trap "make waf-runner-ip-remove CIDR=$$RUNNER_IP $(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE),)" EXIT && \
	  make waf-runner-ip-add CIDR=$$RUNNER_IP $(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE),) && \
	  make smoke ITER=$(ITER) SLICE=$(SLICE) $(if $(PROD_URL),PROD_URL=$(PROD_URL),)

# --- IMP-009 L2: validate-impacted — impacted ∪ regression-core (OI-45) -------
# Per-slice FAST PATH: run only the specs whose covered nodes changed in the
# SINCE window (from make impacted-tests) UNION the committed REGRESSION CORE.
# The full make smoke / make validate remain UNCHANGED as the periodic backstop.
#
# COVERAGE GUARD (process §17, IMP-009 §3):
#   - The regression core ALWAYS runs (a break in a core user journey cannot
#     be skipped regardless of what changed).
#   - Any uncovered-changed-node in impacted-tests output STILL forces a spec
#     or explicit waiver (existing §12a rule — unchanged).
#   - The skipped specs are LOGGED in the script output (never silent coverage
#     narrowing). Run make smoke at chunk delivery as the periodic full backstop.
#
# make validate-impacted SINCE=<sha> ITER=<n> SLICE=<id> [PROJECT=…] [PROD_URL=…]
validate-impacted:
	$(if $(PROD_URL),PROD_URL=$(PROD_URL) ,)node work/$(PROJECT)/scripts/validate-impacted.js \
	  --since $(SINCE) --project $(PROJECT) \
	  $(if $(PROD_URL),--prod-url $(PROD_URL),) && \
	$(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent tester --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):validate-impacted" --outcome success \
	  --note "impacted+core smoke green (SINCE=$(SINCE)) via make validate-impacted" || \
	( $(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent tester --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):validate-impacted" --outcome fail \
	  --note "impacted+core smoke FAILED (SINCE=$(SINCE)) via make validate-impacted" ; exit 1 )

# validate-impacted-ci: runner-IP exemption + validate-impacted + always remove.
# Mirrors smoke-ci for the impacted+core fast path. Use in CI / when the runner
# IP is NOT already exempt from WAF + WS authorizer rate limits.
#
# make validate-impacted-ci SINCE=<sha> ITER=<n> SLICE=<id> [PROD_URL=…] [AWS_PROFILE=dev-int]
validate-impacted-ci:
	@RUNNER_IP=$$(curl -s https://checkip.amazonaws.com)/32 && \
	  echo "Runner CIDR: $$RUNNER_IP" && \
	  trap "make waf-runner-ip-remove CIDR=$$RUNNER_IP $(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE),)" EXIT && \
	  make waf-runner-ip-add CIDR=$$RUNNER_IP $(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE),) && \
	  make validate-impacted SINCE=$(SINCE) ITER=$(ITER) SLICE=$(SLICE) \
	    $(if $(PROD_URL),PROD_URL=$(PROD_URL),)

# Synth all stacks with the project-pinned CDK (not a global npx install).
# STACKS optional: make synth-infra STACKS="OxoGameProd"
# githubOrg/githubRepo go as -c context flags per process §19 (GITHUB_ env prefix is reserved).
GH_ORG  ?= john-aerocloud
GH_REPO ?= claude_learning_agents
synth-infra:
	npm --prefix $(INFRA) run cdk -- synth $(STACKS) --quiet \
	  -c githubOrg=$(GH_ORG) -c githubRepo=$(GH_REPO)

# ---------------------------------------------------------------------------
# OagEventSource-specific targets (EXP-050 PATH bridge — process v55 retro)
#
# These targets export PATH internally to prepend the nvm node bin so that
# node/npm/npx/cdk resolve in non-interactive agent shells WITHOUT depending
# on the session-start settings.json env injection (which doesn't reach
# mid-session subagent shells). This is leg-b of EXP-050.
#
# All commands use absolute paths from repo root (§IMP-001 / allowlist contract).
#
# OAG_INFRA := work/OagEventSource/src/infra  (aliased below for clarity)
# ---------------------------------------------------------------------------
OAG_APP   := work/OagEventSource/src/app
OAG_INFRA := work/OagEventSource/src/infra
OAG_LOCAL := work/OagEventSource/src/app/local
NVM_NODE_BIN := $(HOME)/.nvm/versions/node/v24.12.0/bin

# EXP-050 leg-b: embed PATH in every recipe line so node/npx/cdk resolve in
# non-interactive agent shells without depending on the session env.
# macOS GNU Make 3.81: 'export PATH :=' modifies Make's variable but does NOT
# propagate to recipe sub-shells. The correct fix is a per-recipe PATH prefix.
# Each recipe below starts with PATH=$(NVM_NODE_BIN):$$PATH so the correct
# node binary is found regardless of how make was invoked.

# make test-app-oag  — vitest run for the domain core (no DDB)
test-app-oag:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_APP) run test:run

# make lint-app-oag
lint-app-oag:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_APP) run lint

# make build-app-oag
build-app-oag:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_APP) run build

# make bundle-lambda-oag  — UC-18: esbuild-bundle the flight-feed-api handler
# from src/app into src/infra/assets/feed-handler/handler.js (CommonJS,
# @aws-sdk/* external). The CDK stack references that asset via
# lambda.Code.fromAsset; CI runs this before synth/deploy so the deployed
# Lambda ships the REAL handler (not the bootstrap inline 503 stub).
bundle-lambda-oag:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_APP) run bundle:lambda

# make test-infra-oag  — jest policy-check assertions on the synthesized template (offline)
test-infra-oag:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_INFRA) test

# make synth-infra-oag  — CDK synth OagFeedStack (offline; no AWS creds needed)
# OAG_BUILD_SHA optional: make synth-infra-oag OAG_BUILD_SHA=$(git rev-parse HEAD)
OAG_BUILD_SHA ?= local
synth-infra-oag:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_INFRA) run cdk -- synth OagFeedStack --quiet \
	  -c buildSha=$(OAG_BUILD_SHA)

# make diff-oag  — CDK diff (requires live AWS creds + bootstrap complete)
diff-oag:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_INFRA) run cdk -- diff OagFeedStack \
	  -c buildSha=$$(git rev-parse --short HEAD 2>/dev/null || echo local) \
	  --profile $(AWS_PROFILE)

# make deploy-oag  — CDK deploy OagFeedStack (sandbox)
# §F5 HUMAN GATE — run this only after the human approves the first deploy.
# Prerequisites:
#   1. make -C work/OagEventSource/src/infra bootstrap  (CDK bootstrap in eu-west-2)
#   2. Secrets Manager: dash0 API key secret exists in eu-west-2 (OAG_DASH0_SECRET_ARN)
#   3. OTel layer ARNs filled in lib/oag-feed-stack.ts OTEL_LAYER_ARNS (from delta-001)
deploy-oag:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_INFRA) run cdk -- deploy OagFeedStack \
	  --require-approval never \
	  -c buildSha=$$(git rev-parse HEAD 2>/dev/null || echo local) \
	  --profile $(AWS_PROFILE)

# ---------------------------------------------------------------------------
# OagEventSource — dev environment targets (ids-dev account 484908302294)
# ---------------------------------------------------------------------------
# HARD CONSTRAINT: ids-dev SSO profile is ReadOnly. The one-time bootstrap
# and deploy-oidc-oag-dev MUST be run with an elevated/admin profile.
# See work/OagEventSource/runbook/dev-prod-deploy.md.

# make bootstrap-oag-dev
# One-time CDK bootstrap for ids-dev. Requires an elevated IAM role (NOT ReadOnly).
# Pass ADMIN_PROFILE=<elevated-profile> to override.
ADMIN_PROFILE_DEV  ?= ids-dev
bootstrap-oag-dev:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_INFRA) run cdk -- bootstrap \
	  aws://484908302294/eu-west-2 \
	  --trust 484908302294 \
	  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess \
	  --profile $(ADMIN_PROFILE_DEV)

# make deploy-oidc-oag-dev
# One-time: deploy the OIDC role stack into ids-dev. Requires elevated credentials.
deploy-oidc-oag-dev:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_INFRA) run cdk -- deploy OagOidcStack-dev \
	  --require-approval never \
	  -c githubOrg=john-aerocloud \
	  -c githubRepo=claude_learning_agents \
	  -c accountEnv=dev \
	  --profile $(ADMIN_PROFILE_DEV)

# make diff-oag-dev
diff-oag-dev:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_INFRA) run cdk -- diff OagFeedStack-dev \
	  -c buildSha=$$(git rev-parse --short HEAD 2>/dev/null || echo local) \
	  --profile ids-dev

# make deploy-oag-dev  — §F5 HUMAN GATE; CI uses this after OIDC role is provisioned
deploy-oag-dev:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_INFRA) run cdk -- deploy OagFeedStack-dev \
	  --require-approval never \
	  -c buildSha=$$(git rev-parse HEAD 2>/dev/null || echo local) \
	  --profile ids-dev

# ---------------------------------------------------------------------------
# OagEventSource — prod environment targets (ids-prod account 716403253029)
# ---------------------------------------------------------------------------
# HARD CONSTRAINT: ids-prod SSO profile is ReadOnly. The one-time bootstrap
# and deploy-oidc-oag-prod MUST be run with an elevated/admin profile.
# See work/OagEventSource/runbook/dev-prod-deploy.md.

ADMIN_PROFILE_PROD ?= ids-prod
bootstrap-oag-prod:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_INFRA) run cdk -- bootstrap \
	  aws://716403253029/eu-west-2 \
	  --trust 716403253029 \
	  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess \
	  --profile $(ADMIN_PROFILE_PROD)

deploy-oidc-oag-prod:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_INFRA) run cdk -- deploy OagOidcStack-prod \
	  --require-approval never \
	  -c githubOrg=john-aerocloud \
	  -c githubRepo=claude_learning_agents \
	  -c accountEnv=prod \
	  --profile $(ADMIN_PROFILE_PROD)

diff-oag-prod:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_INFRA) run cdk -- diff OagFeedStack-prod \
	  -c buildSha=$$(git rev-parse --short HEAD 2>/dev/null || echo local) \
	  --profile ids-prod

deploy-oag-prod:
	PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_INFRA) run cdk -- deploy OagFeedStack-prod \
	  --require-approval never \
	  -c buildSha=$$(git rev-parse HEAD 2>/dev/null || echo local) \
	  --profile ids-prod

# make test-adapter-oag  — UC-22 DynamoDB Local adapter test suite
# Requires DDB Local running: make ddb-local-up
test-adapter-oag:
	DYNAMODB_ENDPOINT=http://localhost:8000 PATH=$(NVM_NODE_BIN):$$PATH npm --prefix $(OAG_APP) run test:adapter

# make ddb-local-up  — start DynamoDB Local (detached; UC-22 prerequisite)
ddb-local-up:
	docker compose -f $(OAG_LOCAL)/docker-compose.yml up -d

# make ddb-local-down  — stop and remove DynamoDB Local
ddb-local-down:
	docker compose -f $(OAG_LOCAL)/docker-compose.yml down

# make ddb-local-create-table  — create the OagFeed-EventStore table in DDB Local
# Run after ddb-local-up; the adapter test suite also does this at setup,
# but this target is useful for manual inspection during development.
ddb-local-create-table:
	aws dynamodb create-table \
	  --table-name OagFeed-EventStore \
	  --attribute-definitions \
	    AttributeName=PK,AttributeType=S \
	    AttributeName=SK,AttributeType=S \
	  --key-schema \
	    AttributeName=PK,KeyType=HASH \
	    AttributeName=SK,KeyType=RANGE \
	  --billing-mode PAY_PER_REQUEST \
	  --endpoint-url http://localhost:8000 \
	  --region local \
	  --no-cli-pager 2>/dev/null || echo "Table already exists — continuing"

# make seed-oag — UC-20: write 2 synthetic canonical events to the sandbox event store.
# Reads TABLE_NAME from env (default OagFeed-EventStore-s004); AWS_PROFILE defaults to
# the project profile. Run after deploy-oag.
OAG_SEED_TABLE ?= OagFeed-EventStore-s004
seed-oag:
	TABLE_NAME=$(OAG_SEED_TABLE) AWS_PROFILE=$(AWS_PROFILE) AWS_REGION=eu-west-2 \
	  PATH=$(NVM_NODE_BIN):$$PATH node work/OagEventSource/src/app/scripts/seed-event-store.mjs

.PHONY: test-app-oag lint-app-oag build-app-oag bundle-lambda-oag test-infra-oag synth-infra-oag diff-oag deploy-oag seed-oag test-adapter-oag ddb-local-up ddb-local-down ddb-local-create-table bootstrap-oag-dev deploy-oidc-oag-dev diff-oag-dev deploy-oag-dev bootstrap-oag-prod deploy-oidc-oag-prod diff-oag-prod deploy-oag-prod

# s007 SHARED §11a probe (UC1+UC3): two-browser disconnect skeleton against the
# DEPLOYED path (Playwright, two real browsers — pair, close one tab, survivor
# sees "Your opponent disconnected." + returns to the mode selector ≤10s). NOT a
# node probe (FALSE GREEN below CSP/transport). Skeleton-gated like move-skeleton;
# green-in-prod requires UC1 handler (E4) + UC3 SPA (E5) deployed. Run post-deploy.
#   make disconnect-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
disconnect-skeleton:
	PROD_URL=$(PROD_URL) npm --prefix $(APP) run test:skeleton:disconnect

# s008 §11a probe (UC2): deep-link boots the SPA on the DEPLOYED origin. A real
# browser creates a game to mint a real code, then a SECOND browser navigates to
# https://<domain>/join/<code> and asserts the SPA boots (NOT an edge error) with
# the code pre-filled + Join enabled. Real browser (Playwright), NOT a node probe
# (FALSE GREEN below CloudFront/CSP/transport). Skeleton-gated like move-skeleton/
# disconnect-skeleton; green-in-prod requires the UC1+UC2 SPA deployed. Run post-deploy.
#   make join-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
join-skeleton:
	PROD_URL=$(PROD_URL) npm --prefix $(APP) run test:skeleton:join

# s005-h3 §11a probe (UC2/UC3): drive the DEPLOYED create-game path and prove the
# storage-enforced code-uniqueness invariant (delta 009, OI-3). Fires COUNT
# concurrent POST /api/games against the deployed origin and asserts ALL returned
# codes are DISTINCT — the proof the conditional-PutItem CAS truly guarantees
# uniqueness under concurrency (SM-2 lite). The create surface is a backend HTTP
# API, so the real client here is an HTTP request (no browser/CSP layer applies).
# The tester runs the full SM-2 50-concurrent + Codes-table no-duplicate-PK scan.
#   make uniqueness-probe API_BASE=https://d3pf3kcvzpau1x.cloudfront.net [COUNT=10]
COUNT ?= 10
uniqueness-probe:
	node work/$(PROJECT)/scripts/uniqueness-probe.js --api-base $(API_BASE) --count $(COUNT)

# s009 §30 walking-skeleton (T-LB-10) — the FIRST DynamoDB Stream gate. Drives ONE
# controlled active→won Games transition through the DEPLOYED stream path and
# asserts Probe A (one game-over → exactly one increment; each scoredGames carries
# the gameId once) + Probe B (replay the same transition → Leaderboard rows
# byte-identical, `already_scored` ConditionalCheckFailed in oxo-board-fn logs).
# Records a DORA validation_run row (success/fail) mirroring ws-skeleton. The §30
# real client for a DynamoDB Stream is a real DynamoDB write that fires the real
# stream — a node script using the `aws` CLI (NOT a unit mock; the mock cannot see
# real sharding/redelivery/set-contains atomicity). Post-deploy gate; MUST be
# green before UC5 (E2). Requires AWS creds in env (export the SSO profile).
#   make board-stream-skeleton ITER=14 SLICE=s009-arcade-scoreboard \
#     GAMES_TABLE=oxo-games LEADERBOARD_TABLE=oxo-leaderboard \
#     BOARD_FN_LOG_GROUP=/aws/lambda/oxo-board-fn [AWS_PROFILE=dev-int]
GAMES_TABLE        ?= oxo-games
LEADERBOARD_TABLE  ?= oxo-leaderboard
BOARD_FN_LOG_GROUP ?= /aws/lambda/oxo-board-fn
board-stream-skeleton:
	node work/$(PROJECT)/scripts/board-stream-skeleton.js \
	  --games-table $(GAMES_TABLE) --leaderboard-table $(LEADERBOARD_TABLE) \
	  --board-fn-log-group $(BOARD_FN_LOG_GROUP) \
	  $(if $(AWS_PROFILE),--profile $(AWS_PROFILE),) && \
	$(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent engineer --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):board-stream-skeleton" --outcome success \
	  --note "§30 DynamoDB Stream skeleton Probe A+B green vs prod (T-LB-10)" || \
	( $(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent engineer --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):board-stream-skeleton" --outcome fail \
	  --note "§30 DynamoDB Stream skeleton FAILED vs prod (T-LB-10)" ; exit 1 )

# --- Observatory validation entrypoints (CHK-2) --------------------------------
# test-observatory: single Vitest suite covering domain (server/__tests__) +
# SPA (src/__tests__) — one command, one project, single-server topology.
# browser-observatory: Playwright map-render + keyboard-nav specs (local).
# Both targets bypass the APP/validate machinery (observatory is local-only; no
# cloud deploy gate, no test:validation suite).
test-observatory:
	npm --prefix work/observatory/src/app run test:ci

browser-observatory:
	npm --prefix work/observatory/src/app run test:browser

# browser-observatory-ephemeral: run the Playwright browser specs against an
# EPHEMERAL Vite server on :5199 (against the committed fixture repo), so the run
# never touches an operator's running :5173. Playwright starts AND tears down the
# :5199 server itself (OBSERVATORY_E2E_PORT + CI force a non-reused own-server).
# --workers=1 SERIALISES the run: the UC-S005-6 live-refresh spec MUTATES the
# shared items.csv fixture (append a row → tree re-renders → restore in afterEach),
# so it must fully complete its restore before any deterministic spec that asserts
# an exact items.csv-derived node count / map height (work-item-tree.spec.js,
# detail-pane-geometry.spec.js) runs — single-worker sequential execution
# guarantees that with no cross-file race.
browser-observatory-ephemeral:
	OBSERVATORY_E2E_PORT=5199 CI=1 npm --prefix work/observatory/src/app run test:browser -- --workers=1

# browser-observatory-real-data: run the EXP-033 real-data spec against a
# PRE-STARTED ephemeral Vite server on :5203 (pointing at the live observatory
# repo, not the fixture). Requires the operator to have already started:
#   npm --prefix work/observatory/src/app run dev -- --port 5203
# The spec is gated on REUSE_SERVER=1 and skipped by the fixture-backed suite.
# After the run the operator should kill the :5203 server by PID (never pkill -f vite).
browser-observatory-real-data:
	OBSERVATORY_E2E_PORT=5203 REUSE_SERVER=1 npm --prefix work/observatory/src/app run test:browser -- e2e/s005-real-data.spec.js

.PHONY: sso-login dora-record dora-compute validate smoke waf-probe waf-sustained ws-skeleton test-app lint-app build-app run-local test-local move-skeleton test-infra synth-infra waf-runner-ip-add waf-runner-ip-remove smoke-ci validate-impacted validate-impacted-ci test-scripts disconnect-skeleton join-skeleton uniqueness-probe impacted-tests test-tools board-stream-skeleton test-observatory browser-observatory browser-observatory-ephemeral browser-observatory-real-data a11y-observatory

# make dora-flow PROJECT=oxo-online  -> rewrites work/<project>/dora/flow.md
# (per-project queues + time thieves + parallelism efficiency). v40 pull-flow view.
.PHONY: dora-flow flow-status
dora-flow:
	$(DORA) flow --project $(PROJECT)

# make flow-status PROJECT=oxo-online  -> refresh + print the flow view and queue depths
flow-status:
	$(DORA) flow --project $(PROJECT)
	@echo '--- queues (depth = rows) ---'
	@for q in intake ready deploy rework; do n=$$(($$(wc -l < work/$(PROJECT)/queues/$$q.csv 2>/dev/null || echo 1)-1)); echo "$$q: $$n"; done
	@cat work/$(PROJECT)/dora/flow.md
