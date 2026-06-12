// UC-S013-3 — DefectDetail: the labelled record body inside the defect drill
// drawer. Four fields (Expected/Actual/Intent/Importance) + Classification +
// Root cause + Resolution + fix sha(s), in a FIXED reading order, with every
// markdown-bearing value rendered through the SHARED lib/markdown.js transform
// (the same path ArtifactView uses — ONE markdown renderer in the codebase,
// S13-3-FIG-6; never raw `**`/`##` in visible text).
//
// HEXAGONAL ROLE: pure render of the raw UC-S013-1 endpoint record (all 17
// fields, already in useDefects state — the drill is a pure projection; no
// fetch here).
//
// STRUCTURE NOTE (selector contract): each field section is an <h3>
// data-testid="defect-field-<name>" + a markdown body carrying
// data-field="<name>". The ui-design sketch mentions a <dl> for the four
// fields, but headings cannot nest inside <dt> (HTML content model), so the
// per-field <h3> form — the one the selector contract + GEO-S013-3-3 assert
// on — is used for all seven fields; the status/severity meta keeps the
// labelled dt/dd idiom.
//
// NULL HANDLING (S13-3-FIG-4/5): any null field renders "—" — never blank,
// never raw "null", never a throw; fix_sha=null → "—", never a fabricated sha.
//
// PROVENANCE (S13-3-FIG-7): data-source names the record's origin — the .md
// file for file-backed defects, the ledger ref for ledger-only ones — and a
// visible "↗ source" caption names it.
import { mdToHtml } from '../lib/markdown.js';

const FIELDS = [
  { key: 'expected', name: 'expected', label: 'Expected' },
  { key: 'actual', name: 'actual', label: 'Actual' },
  { key: 'intent', name: 'intent', label: 'Intent' },
  { key: 'importance', name: 'importance', label: 'Importance' },
  { key: 'classification', name: 'classification', label: 'Classification' },
  { key: 'root_cause', name: 'root-cause', label: 'Root cause' },
  { key: 'resolution_text', name: 'resolution', label: 'Resolution' },
];

/** Comma-joined sha string → trimmed tokens (null/empty → []). */
function fixShas(fixSha) {
  if (typeof fixSha !== 'string') return [];
  return fixSha
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The record's provenance ref: the .md file when file-backed, else the
 *  ledger rows the record was derived from (DEFECT-011 ledger-only case). */
function sourceRef(defect) {
  const file = defect?.source?.file;
  return typeof file === 'string' && file
    ? { ref: `work/<project>/defects/${file}`, label: file }
    : { ref: `process/dora/ledger.csv#ref=${defect.id}`, label: `process/dora/ledger.csv#ref=${defect.id}` };
}

/** One field section: <h3> + markdown body (or the "—" placeholder). */
function FieldSection({ name, label, value, children }) {
  const hasValue = typeof value === 'string' && value.trim().length > 0;
  return (
    <section class="defect-field">
      <h3 class="defect-field__h" data-testid={`defect-field-${name}`}>
        {label}
      </h3>
      {hasValue ? (
        <div
          class="defect-field__md markdown-body"
          data-field={name}
          // mdToHtml output is trusted defect-record content from our own repo
          // (same trust decision as ArtifactView's slice artifacts)
          dangerouslySetInnerHTML={{ __html: mdToHtml(value) }}
        />
      ) : (
        <p class="defect-field__md defect-field__md--absent" data-field={name}>
          —
        </p>
      )}
      {children}
    </section>
  );
}

/**
 * @param {object} props
 * @param {object} props.defect - raw UC-S013-1 endpoint record (17 fields)
 */
export function DefectDetail({ defect }) {
  const shas = fixShas(defect.fix_sha);
  const src = sourceRef(defect);
  return (
    <div class="defect-detail" data-testid="defect-detail" data-source={src.ref}>
      {/* status + severity meta — labelled dt/dd, unknown severity = "—" */}
      <dl class="defect-detail__meta">
        <div class="defect-detail__meta-pair">
          <dt>Status</dt>
          <dd data-testid="defect-detail-status">{defect.status || '—'}</dd>
        </div>
        <div class="defect-detail__meta-pair">
          <dt>Severity</dt>
          <dd data-testid="defect-detail-severity">{defect.severity || '—'}</dd>
        </div>
      </dl>

      {FIELDS.map(({ key, name, label }) => (
        <FieldSection key={name} name={name} label={label} value={defect[key]}>
          {name === 'resolution' ? (
            // fix shas ride under the Resolution section WITH a "Fix" label —
            // a sha is a machine token; the sentence is its human context.
            <p class="defect-detail__fix" data-testid="defect-fix">
              <span class="defect-detail__fix-label">Fix:</span>{' '}
              {shas.length > 0
                ? shas.map((sha) => (
                    <code class="defect-detail__fix-sha" data-testid="defect-fix-sha" key={sha}>
                      {sha}
                    </code>
                  ))
                : '—'}
            </p>
          ) : null}
        </FieldSection>
      ))}

      {/* visible provenance caption (S13-3-FIG-7) */}
      <p class="defect-detail__source" data-testid="defect-detail-source">
        <span aria-hidden="true">↗</span> source: {src.label}
      </p>
    </div>
  );
}
