# Version 2 — Process diagrams

Loops, gates, and queues of the pull-based system. Mermaid source (renders on
GitHub and any mermaid viewer). An at-a-glance SVG overview was shown in chat; this
file is the durable, detailed set.

Legend across all diagrams: **◆ = human gate** (only two exist); dashed = control /
feedback; solid = work flow.

---

## 1. Work-item hierarchy & two-way links

Parent is canonical; the child index is rebuilt from parents on every mutation, so
the tree traverses both ways without drift. Every node carries its own DORA.

```mermaid
flowchart TD
  REQ["REQ-001 requirement<br/><i>JTBD · value/cost · own DORA</i>"]
  CHK1["CHK-001 chunk"]
  CHK2["CHK-002 chunk"]
  SLC1["SLC-007 slice"]
  SLC2["SLC-008 slice"]
  UC1["UC-031 use-case"]
  UC2["UC-032 use-case"]
  UC3["UC-033 use-case"]
  RS["route steps<br/>(red→green commits)"]

  REQ --> CHK1 & CHK2
  CHK1 --> SLC1 & SLC2
  SLC1 --> UC1 & UC2
  SLC2 --> UC3
  UC1 --> RS

  REQ -. "child index (rebuilt)" .-> CHK1
  classDef g stroke-dasharray:4 3;
```

Done bubbles **up**: a slice is `done` when all its use-cases are `done`; a chunk
when its done-condition is met; a requirement when all chunks are `done` (→ ask for
more work). Lead time of any node = its first descendant `created` → its last
descendant `done`.

---

## 2. The full pull flow — loops, queues, gates

```mermaid
flowchart LR
  NW["New work<br/>requirement / defect"]
  G1{{"◆ GATE 1 — Intake<br/>JTBD value · value/cost"}}
  BK[("Backlog<br/>items.csv")]
  RQ[["Ready queue<br/>buffer min..max (retro-tuned)<br/>prioritised · wait measured"]]

  subgraph LOOP["Inner dev loop — pull ONE use-case (per-stage DORA)"]
    direction LR
    C["cicd<br/>capability?"] --> U1["ui-designer<br/>structure (if UI)"]
    U1 --> EN["engineer<br/>TDD on trunk"]
    EN --> U2["ui-designer<br/>validate vs principles"]
    U2 --> G2{{"◆ GATE 2 — Deploy<br/>infra-bearing only"}}
    G2 --> TST["tester<br/>validate in prod"]
  end

  DONE["Done<br/>bubble up slice→chunk→req"]
  FM["flow-manager<br/>cost · prioritise · buffer"]
  PR["product<br/>replenish"]
  RT["Retro + experiments<br/>(process owner · ToC)"]
  MORE(["Requirement done →<br/>ask for more work"])

  NW --> G1 --> BK --> RQ
  RQ -->|pull| C
  TST -->|pass| DONE
  TST -. "fail → Rework (MTTR)" .-> EN

  FM -. owns .-> BK
  FM -. owns .-> RQ
  RQ -. "length < ready.min_items" .-> FM
  FM -. trigger .-> PR
  PR -. "more UCs / next slice / next chunk" .-> RQ

  DONE -. each cycle .-> RT
  RT -. "tune buffer / process" .-> LOOP
  DONE -. all chunks done .-> MORE
  MORE -. new requirement .-> G1
  NW -. "defects pre-empt (head of queue)" .-> RQ
```

Two blocking gates only: **Intake** (value in) and **Deploy** for infra-bearing
change (risk out). Former gates 2 (slice) and 3 (arch+security) are replaced by
named assurances (see design §9), not removed blind.

---

## 3. Use-case lifecycle (state machine)

Every transition emits a ledger row, so the lifecycle *is* the measured flow.

```mermaid
stateDiagram-v2
  [*] --> drafted
  drafted --> costed: product value+cost
  costed --> queued: enqueue(Ready)
  queued --> pulled: dequeue  %% wait time = dequeue - enqueue
  pulled --> building: (cicd? ui-structure?)
  building --> built: acceptance cases green
  built --> deploying
  deploying --> deployed: pipeline slot
  deployed --> validating: tester
  validating --> done: pass
  validating --> rework: fail (MTTR clock)
  rework --> building: defect-as-spec
  done --> [*]
```

---

## 4. Queues, handovers & where time is stolen

**Every queue uses the same model** — `min_items` + `wip_limit` knobs and the four
metrics length/throughput/dwell/rework (retro-tuned — design §3/§7b); the in-loop
stages are a WIP pipeline (timestamped, not buffered). Each labelled wait is a
**time thief**, attributed to its cause and ranked in the retro.

```mermaid
flowchart TD
  subgraph Q["Queues — uniform min_items+WIP + length/throughput/dwell/rework"]
    IN[("Intake<br/>min_items + WIP")]
    RDY[["Ready<br/>min_items + WIP"]]
    DPL[("Deploy<br/>min_items + WIP")]
    RWK[("Rework<br/>min_items + WIP")]
  end

  IN --> RDY
  RDY -->|pull| WIP
  subgraph WIP["WIP pipeline — stage_enter / stage_exit timestamps"]
    direction LR
    s1[cicd] --> s2[ui] --> s3[engineer] --> s4[ui-validate] --> s5[deploy]
  end
  s5 --> DPL --> s6[tester] --> OUT["done"]
  s6 -. fail .-> RWK -. fix .-> s3

  T1["⏱ queue wait<br/>= dequeue − enqueue"]:::t -. inflicts .-> RDY
  T2["⏱ displacement<br/>(higher v/c or defect ahead)"]:::t -. attributed to .-> RDY
  T3["⏱ seam serialisation<br/>UC blocked by UC"]:::t -. attributed to .-> s3
  T4["⏱ worker contention<br/>(> N in flight)"]:::t -. attributed to .-> WIP
  T5["⏱ deploy-queue wait"]:::t -. attributed to .-> DPL

  classDef t stroke-dasharray:4 3;
```

`dora.py` computes, per item: lead time = service time + Σ(these waits), with each
wait labelled by cause. The retro attacks the largest total (worked example in
`02-example-retro.md`).

---

## 5. Parallel pull & the dependency-tree learning loop (design §13)

The dispatcher fills capacity `N` with the maximal independent set; collisions
prove a declared independence false, correct the model, and feed two quality
metrics back to the retro.

```mermaid
flowchart TD
  DAG["Dependency model<br/>use-case-deps.mmd ∪ class-deps.mmd"]
  MIS["flow-manager:<br/>maximal independent set (≤ N)<br/>+ claimed seam/path registry"]
  DAG --> MIS
  MIS -->|"parallel_dispatch"| P1["dev loop · UC-A"]
  MIS --> P2["dev loop · UC-B"]
  MIS --> P3["dev loop · UC-C"]

  P1 --> CK{"claimed-set<br/>violation?"}
  P2 --> CK
  P3 --> CK
  CK -->|no| DONE["done · bubble up"]
  CK -->|"yes = COLLISION"| COL["emit collision · stop pair<br/>add missing edge · re-serialise (§19)<br/>rework = time thief"]
  COL -->|correct| DAG

  subgraph LEARN["retro: dependency-tree quality"]
    H["hidden-edge rate<br/>(false independence) → 0"]
    F["false-edge rate<br/>(needless serialisation)"]
    PE["parallelism efficiency<br/>achieved ÷ max set"]
  end
  COL -. counts .-> H
  MIS -. logs .-> PE
  TRIAL["edge null-hypothesis trial<br/>relax edge · 4–5 opportunities"] -. "no collision → drop edge" .-> DAG
  F -. proposes .-> TRIAL
  PE -. "low ⇒ raise N or relax edges" .-> F
```

Hidden edges are found by *running* concurrently and colliding; false edges are
found by *trialling* a relaxation and **not** colliding. Driving both toward zero
is the system learning to structure dependency trees that are neither over- nor
under-connected.
