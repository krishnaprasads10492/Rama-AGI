import { useCallback, useState } from 'react';
import { useUserStore } from '@store/userStore.js';
import { FS, LH } from '@config/type.js';
import { byRoute, headline, limits, oneLine, rows, state } from './securityModel.js';

/**
 * SecurityPanel — what the installed dependency tree actually contains (spec Section 182)
 *
 * THE SCREEN THAT WAS DELIBERATELY BUILT LAST. Section 180.5 ran the dependency scan live and it
 * reported ZERO while `npm audit` reported twenty on the same machine: the OSV pass asks about the
 * 24 names in package.json and answers per package, so seventeen transitive advisories and three
 * reached THROUGH a direct dependency were all outside its question. Had this panel existed then,
 * it would have shown master a clean bill of health for a tree with three high-severity findings in
 * it. So the coverage fix and the triage were built first, and the screen last, on the rule that a
 * security UI which can display a clean it did not verify is worse than no security UI.
 *
 * EVERY SENTENCE COMES FROM `securityModel.js`. Nothing here composes prose from the payload, and
 * `scripts/verifyUiSecurity.mjs` reads this file to hold that shut — including a word-bounded ban on
 * "clean", "secure", "score" and "grade" appearing in the markup, because the model can be
 * impeccable while a heading above it says "All clear".
 *
 * THE SCAN IS A BUTTON, NOT A MOUNT EFFECT. It shells out to `npm audit` over the whole installed
 * tree and takes the better part of a minute, so opening the System tab must not start it. Section
 * 168.2's ruling applies: auto-check means auto-REPORT, and a check master did not ask for is one
 * whose cost he cannot see.
 *
 * IT APPLIES NOTHING. Every remedy is prose. I12 pins deliberately, Section 173 found npm itself
 * proposing two DOWNGRADES as "fixes", and a button that took those would have made the tree worse.
 */
export default function SecurityPanel() {
  const { currentUser } = useUserStore();
  const [payload, setPayload] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [includeDev, setIncludeDev] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    // An unregistered channel resolves to `undefined`, and a bridge that is absent entirely (web
    // build, locked vault) throws — both become a reported failure rather than a silent empty
    // panel, which would be indistinguishable from "nothing found".
    const res = await window.rama?.refresh?.deps?.({ user: currentUser, includeDev })
      ?.catch((err) => ({ ok: false, error: err.message }));
    setPayload(res ?? { ok: false, error: 'The dependency review channel did not answer.' });
    setScanning(false);
  }, [currentUser, includeDev]);

  const s = state(payload);
  const h = headline(payload);
  const routes = byRoute(payload);
  const all = rows(payload);
  const shown = showAll ? all : all.slice(0, 8);
  const notes = limits(payload);

  return (
    <div className="hud-card" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="section-label">DEPENDENCY ADVISORIES</div>
        <span style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)' }}>
          {oneLine(payload)}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={includeDev} disabled={scanning}
              onChange={(e) => setIncludeDev(e.target.checked)} />
            build-only packages
          </label>
          <button className="btn btn-sm" onClick={scan} disabled={scanning}>
            {scanning ? 'Reading the tree…' : 'Scan now'}
          </button>
        </div>
      </div>

      {/* The status line, which says WHICH nothing this is: not yet run, refused, withheld by
          policy, or half-complete. Four different situations that a single empty state would
          collapse into one misleading one. */}
      <div style={{
        fontSize: FS.chrome,
        lineHeight: 1.6,
        marginBottom: 10,
        color: s.kind === 'failed' ? 'var(--red)'
          : (s.kind === 'partial' || s.kind === 'withheld') ? 'var(--amber)' : 'var(--text-dim)',
      }}>
        <strong>{s.title}</strong>
        {s.detail ? <span> — {s.detail}</span> : null}
      </div>

      {s.kind === 'idle' ? (
        <div style={{ fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--muted)' }}>
          The scan reads the installed tree with npm audit and reports what it finds. It changes
          nothing and installs nothing.
        </div>
      ) : null}

      {s.kind === 'ready' || s.kind === 'partial' || s.kind === 'withheld' ? (
        <>
          {/* TWO NUMBERS, EACH WITH THE QUESTION IT ANSWERED. Never one merged figure: the whole
              measured defect of Section 180.5 was a number read as covering more than it did. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginBottom: 10 }}>
            {[['Narrow scan', h.narrow], ['Tree-wide scan', h.wide]].map(([label, side]) => (
              <div key={label} style={{ padding: '10px 12px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {label}
                </div>
                <div style={{ fontSize: FS.h2, lineHeight: LH.head, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>
                  {side.found === null ? '—' : side.found}
                  <span style={{ fontSize: FS.chrome, fontWeight: 400, color: 'var(--text-dim)' }}>
                    {' '}of {side.asked === null ? '—' : side.asked}
                  </span>
                </div>
                <div style={{ fontSize: FS.chrome, lineHeight: 1.5, color: 'var(--text-dim)', marginTop: 2 }}>
                  {side.question}
                </div>
              </div>
            ))}
          </div>

          {/* THE MOST USEFUL SENTENCE ON THE SCREEN when it fires: the two sources disagreeing,
              with the reason, and which one to believe. */}
          {h.disagreement ? (
            <div style={{ padding: '10px 12px', marginBottom: 10, borderRadius: 'var(--radius)', border: '1px solid var(--amber)', background: 'var(--surface)', color: 'var(--amber)', fontSize: FS.chrome, lineHeight: 1.6 }}>
              {h.disagreement}
            </div>
          ) : null}

          <div style={{ fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--text-dim)', marginBottom: 12 }}>
            {h.caveat}
          </div>

          {/* Routes, in the triage's own reading order. A count of 0 is shown as 0; a count that
              was never measured is shown as a dash. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8, marginBottom: 12 }}>
            {routes.map((r) => (
              <div key={r.route} style={{ padding: '8px 10px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: FS.chrome, lineHeight: 1.5, color: 'var(--text-dim)' }}>{r.label}</span>
                  <span style={{ fontSize: FS.read, lineHeight: LH.tight, fontWeight: 700, color: r.count ? 'var(--text)' : 'var(--muted)' }}>{r.display}</span>
                </div>
              </div>
            ))}
          </div>

          {shown.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {shown.map((f) => (
                <div key={`${f.name}-${f.route}`} style={{ padding: '10px 12px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: FS.chrome, lineHeight: LH.chrome, textTransform: 'uppercase', letterSpacing: '0.06em',
                      padding: '1px 6px', borderRadius: '3px',
                      background: f.severity === 'critical' || f.severity === 'high' ? 'var(--red)' : 'var(--border)',
                      color: f.severity === 'critical' || f.severity === 'high' ? '#fff' : 'var(--text-dim)',
                    }}>
                      {f.severity}
                    </span>
                    <strong style={{ color: 'var(--text)' }}>{f.name}</strong>
                    {f.via ? <span style={{ fontSize: FS.chrome, color: 'var(--text-dim)' }}>{f.via}</span> : null}
                    <span style={{ marginLeft: 'auto', fontSize: FS.chrome, color: f.needsDecision ? 'var(--amber)' : 'var(--muted)' }}>
                      {f.routeLabel}
                    </span>
                  </div>
                  {f.why ? <div style={{ fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--text-dim)', marginTop: 4 }}>{f.why}</div> : null}
                  {f.remedy ? <div style={{ fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--text)', marginTop: 4 }}>→ {f.remedy}</div> : null}
                  {/* Scope sits BESIDE the severity, never inside it: a critical that only runs on
                      the build machine is still a critical. */}
                  {f.scopeNote ? <div style={{ fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--muted)', marginTop: 4 }}>{f.scopeNote}</div> : null}
                  {f.advisories.length > 0 ? (
                    <div style={{ fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--muted)', marginTop: 4 }}>
                      {f.advisories.map((a) => a.title).join(' · ')}
                    </div>
                  ) : null}
                </div>
              ))}
              {all.length > shown.length || showAll ? (
                <button className="btn btn-sm" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Show fewer' : `Show all ${all.length}`}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {/* WHAT THE SCAN DID NOT LOOK AT, always rendered when there is anything to say. A limits
          list collected and then dropped is how a coverage gap becomes an implied guarantee. */}
      {notes.length > 0 ? (
        <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--muted)' }}>
          {notes.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
