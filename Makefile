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
# make validate ITER=5 SLICE=004-create-game   (PROD_URL/AWS_PROFILE via spec defaults)
validate:
	npm --prefix $(APP) run test:validation && \
	$(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent tester --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):validation" --outcome success \
	  --note "tests/validation green via make validate" || \
	( $(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent tester --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):validation" --outcome fail \
	  --note "tests/validation FAILED via make validate" ; exit 1 )

# make smoke ITER=5 SLICE=004-create-game
smoke:
	npm --prefix $(APP) run test:smoke && \
	$(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent tester --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):smoke" --outcome success \
	  --note "tests/smoke green via make smoke" || \
	( $(DORA) record --project $(PROJECT) --iteration $(ITER) --slice $(SLICE) \
	  --agent tester --event validation_run \
	  --ref "$$(git rev-parse --short HEAD):smoke" --outcome fail \
	  --note "tests/smoke FAILED via make smoke" ; exit 1 )

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

.PHONY: dora-record dora-compute validate smoke test-app lint-app build-app test-infra synth-infra
