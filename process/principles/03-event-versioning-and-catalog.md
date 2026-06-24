# Principle 03 — Event versioning, total mapping, and the event catalog

**Consuming a valid stored event must never have a failure mode.** A reader/
consumer that throws, poisons, or drops on a well-formed stored event is a
**design defect**, not a data problem. This is a hard guarantee for every
event-sourced / event-driven system the team builds.

It is made achievable by four rules:

1. **All events are versioned.** Every event carries an explicit schema version.
2. **Every consumer supports all versions.** A consumer reads any version that
   has ever been emitted — it is built and tested against the **full version
   history in the catalog**, not just the latest.
3. **Schema changes are non-destructive and total-mappable.** A `vN` event must
   be deterministically mappable to `vN+1` (and onward). No change removes or
   re-purposes a field in a way that makes an older event unmappable.
4. **Genuinely new data ships with a sensible default, defined as part of the new
   version.** That default is what an older event takes when mapped forward, so
   the forward mapping stays total. Naming the default IS part of versioning the
   event — a new field with no default is an incomplete event-version change.

## Ownership
- **Solution-architect maintains the event catalog**: per-event-type version
  history, the field-level schema of each version, the forward-mapping rule
  `vN → vN+1`, and the default for each newly-added field. Every architecture
  delta that adds or changes an event schema updates the catalog in the same
  slice. An event schema change with no catalog entry is an incomplete design.
- **Documenter keeps the catalog as a CORE document in the project's `actual/`
  folder** (canonical as-built record), current every slice that changes an
  event surface. A stale catalog is a principle failure.
- **Engineer/tester**: consumers are covered by **version-coverage tests** — a
  fixture per historical version proves the consumer maps it without failing.

## Boundary: what "poison" is allowed to mean
Poison/dead-letter classification is reserved for input that is **genuinely
un-parseable or of an unknown document type** — never for a known event whose
shape merely differs by version or omits an optional leg. A `PoisonEventError`
raised because a consumer could not map a known-type stored event is this
principle being violated (see DEFECT-OAG-024 and DEFECT-OAG-025: the diff engine
poisoned on leg-missing folded priors it should have mapped — symptom-guarded,
but the durable prevention is versioned events + catalog + total mapping).
