# Process map — delivery loop, retro points, and change acceptance

Durable reference for **how the agent system operates**: where work flows, where
retrospectives fire, and the lifecycle a retro-proposed change follows before it
becomes permanent. This documents the persistent `/process` self-state (v40+
pull-based flow, STAGE F) — not any one project. Authoritative text lives in
`process-current.md`; this file is the navigable picture of it.

> Scope note: this is agent-process documentation, so it lives in `/process`,
> not in a project's `work/<project>/docs/` (that space is resettable project
> output). Keep it here.

---

## 1. The delivery loop, with retro trigger points

The inner dev loop is **pull-based** (v40): a continuous loop pulls the maximal
independent set of ready use-cases, builds each TDD-on-trunk, deploys per-UC, and
validates in prod. Product replenishes the Ready buffer in parallel. Only **two
human gates** remain — intake and infra-bearing deploy. Retrospectives fire at
the points marked ⟳.

```mermaid
flowchart TD
    INTAKE["🚪 GATE 1 — intake<br/>(JTBD-framed, costed; defects pre-empt)"]
    READY["Ready queue<br/>(costed, per-queue buffered)"]
    PULL["flow-manager: pull maximal<br/>independent set ≤ N"]
    PROD["product: replenish JIT<br/>(parallel, works ahead)"]

    subgraph LOOP["inner dev loop — per pulled use-case (concurrent)"]
      CICD["cicd?<br/>(capabilities if needed)"]
      UIS["ui-designer: STRUCTURE<br/>(if UI-bearing)"]
      ENG["engineer: TDD on trunk<br/>(atomic pull: state+queue+ledger)"]
      UIV["ui-designer: VALIDATE<br/>(if UI-bearing)"]
      DEP["deploy per-UC<br/>🚪 GATE 2 only if infra-bearing"]
      TEST["tester: validate in PROD<br/>(real surface, real data)"]
    end

    DONE["done → bubble UC→slice→chunk→req"]
    REWORK["Rework queue<br/>(MTTR clock runs)"]

    INTAKE --> READY --> PULL --> CICD --> UIS --> ENG --> UIV --> DEP --> TEST
    PROD -.replenish.-> READY
    TEST -->|pass| DONE
    TEST -->|fail| REWORK
    REWORK --> ENG
    DONE -.enqueue-to-empty wakes loop.-> PULL

    %% retro trigger points
    R1(["⟳ slice complete → /retro"])
    R2(["⟳ prod defect → /defect<br/>gap-closing retro"])
    R3(["⟳ event: MTTR pair<br/>or queue-wait spike"])
    R4(["⟳ model release / outage"])
    R5(["⟳ chunk / requirement<br/>boundary (autonomous)"])

    DONE -.->|on slice done| R1
    TEST -.->|defect found in prod| R2
    REWORK -.->|recovery logged| R3
    DONE -.->|chunk/req boundary| R5

    R1 & R2 & R3 & R4 & R5 ==> ACCEPT["change-acceptance pipeline<br/>(§2 below)"]

    classDef gate fill:#7c2d12,color:#fff,stroke:#fff;
    classDef retro fill:#1e3a5f,color:#fff,stroke:#9cf;
    class INTAKE,DEP gate;
    class R1,R2,R3,R4,R5 retro;
```

**When retros fire (the ⟳ points), in practice:**

| Trigger | Cadence | Scope of the retro |
|---|---|---|
| **Slice completion** | Every delivered slice (§F8) | Full: recompute DORA, score the registry, route changes. |
| **Prod defect** (`/defect`) | Every confirmed defect | Focused gap-closing: "what let this through?" → one experiment. |
| **Event** — MTTR pair, queue-wait spike | As the event occurs | Targeted at the surfaced constraint. |
| **Model release / availability incident** | On the event | Re-assess model tiering (§7a); re-tier on outage. |
| **Chunk / requirement boundary** | Autonomous (no human stop) except requirement-complete | Boundary is not a stop-and-ask (EXP-031); requirement-complete IS a human gate (§F3d). |
| **Human-invoked** `/retro` | On demand | Whatever focus question is passed. |

The retro is owned by the **orchestrator**, which gathers each agent's
what-worked/what-hurt but makes the process call. It always: (1) recomputes the
DORA baseline and names the Theory-of-Constraints constraint, (2) scores the
experiment registry, (3) routes each change to its narrowest owner, (4) snapshots
the prior process version to `process-history/`.

---

## 2. Change acceptance — the experiment lifecycle

**Every** retro-proposed change is a registered experiment, not a silent edit.
This is the mechanism that lets the system tell improvement from churn: a change
must name a DORA metric it targets and an anticipated effect, then earn its place
by being scored over a horizon. Nothing becomes permanent until it has
demonstrated value.

```mermaid
flowchart TD
    CHANGE["retro identifies a change"]

    ROUTE{"§36 route to<br/>NARROWEST owner"}
    A1["one agent's behaviour<br/>→ .claude/agents/&lt;agent&gt;.md"]
    A2["cross-agent rule<br/>→ process-current.md (version+1)"]
    A3["repeated manual action<br/>→ committed tool / script / skill"]
    A4["needs building/testing<br/>→ improvement slice (queued)"]

    REG["register row in experiments.md:<br/>target metric · anticipated effect ·<br/>horizon (default 2) · applies-to predicate"]

    SCORE{"scored at each retro<br/>with a real scoring opportunity"}
    EXTEND["no opportunity yet<br/>→ horizon extends"]

    VALID["VALIDATED<br/>(effect observed across horizon)"]
    UQ["UNDER-QUESTION<br/>(horizon reached, no measurable effect)"]

    INTEG["INTEGRATE (§25a/v34):<br/>fold behaviour into owning agent file<br/>as plain practice; remove scaffolding;<br/>file shorter-or-equal"]
    PRUNE["PRUNE row → experiments-archive.md<br/>(one terse line; full row in git)"]

    RESOLVE{"MUST resolve"}
    REWORK2["rewrite as a NEW experiment"]
    TRIAL["retirement-trial:<br/>physically remove the text,<br/>run 4–5 scoring opportunities"]
    REINSTATE["metric drop in window<br/>→ reinstate (it was load-bearing)"]
    RETIRE["no drop across window<br/>→ retire permanently"]

    CHANGE --> ROUTE
    ROUTE --> A1 & A2 & A3 & A4
    A1 & A2 & A3 & A4 --> REG --> SCORE
    SCORE -->|not yet| EXTEND --> SCORE
    SCORE -->|effect seen| VALID
    SCORE -->|horizon hit, flat| UQ
    VALID --> INTEG --> PRUNE
    UQ --> RESOLVE
    RESOLVE --> REWORK2 --> REG
    RESOLVE --> TRIAL
    TRIAL --> REINSTATE
    TRIAL --> RETIRE --> PRUNE

    classDef good fill:#14532d,color:#fff,stroke:#9f9;
    classDef bad fill:#7c2d12,color:#fff,stroke:#fca;
    class VALID,INTEG good;
    class UQ,TRIAL bad;
```

**Key invariants of acceptance:**

- **A change must target a named DORA metric** (throughput/lead-time, CFR,
  deployment frequency, MTTR) and state its anticipated effect, so the next retro
  can score it against reality — not against intention.
- **Agent-def simplicity is a goal.** Text that cannot demonstrate value does not
  stay. Validated behaviour is *folded in* (file shorter-or-equal), not appended;
  unproven text faces a retirement-trial.
- **The registry holds only live experiments.** Terminal rows (integrated /
  retired / reworked) are pruned to `experiments-archive.md` — the index of what
  has been learned and folded in. This keeps the registry from accreting (v45).
- **EXP-011 scores the integration+pruning policy itself** — the next retro
  spot-checks that an integrated mechanism still fires.

---

## 3. How to read the two diagrams together

The delivery loop (§1) is where **evidence is generated** — every slice,
deploy, defect, and recovery writes a DORA ledger row. The acceptance lifecycle
(§2) is where **that evidence decides what the agents become** — a change earns
permanence only by moving a metric over its horizon. The retro is the hinge: it
reads the loop's evidence and drives the lifecycle.

For an honest assessment of whether this machinery is actually improving
delivery performance — and the measurement caveats that complicate that
question — see `process/retro-effectiveness-2026-06-17.md`.
