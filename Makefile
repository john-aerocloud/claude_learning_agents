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

# Synth all stacks with the project-pinned CDK (not a global npx install).
# STACKS optional: make synth-infra STACKS="OxoGameProd"
# githubOrg/githubRepo go as -c context flags per process §19 (GITHUB_ env prefix is reserved).
GH_ORG  ?= john-aerocloud
GH_REPO ?= claude_learning_agents
synth-infra:
	npm --prefix $(INFRA) run cdk -- synth $(STACKS) --quiet \
	  -c githubOrg=$(GH_ORG) -c githubRepo=$(GH_REPO)

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

.PHONY: sso-login dora-record dora-compute validate smoke waf-probe waf-sustained ws-skeleton test-app lint-app build-app run-local test-local move-skeleton test-infra synth-infra waf-runner-ip-add waf-runner-ip-remove smoke-ci test-scripts disconnect-skeleton join-skeleton uniqueness-probe impacted-tests test-tools
