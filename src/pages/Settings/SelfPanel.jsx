import { useCallback, useEffect, useState } from 'react';
import { useUserStore } from '@store/userStore.js';
import { SKILLS } from '@services/cognition.js';
import { resolveVoiceCapability } from '@services/voiceEngine.js';

/**
 * SelfPanel — what Rāma is, what it can do, and what it cannot (spec Section 88).
 *
 * Master: *"without any 'self' how would all capabilities get a meaning"*.
 *
 * The About tab beside this one is a static card of facts about the build. This panel is the
 * opposite: everything shown is measured at the moment you open it, every row states its source,
 * and the LIMITS are given equal weight to the abilities — because a capability list that only
 * lists strengths tells master nothing about where his judgement is still required.
 *
 * `reflexSkills` and the voice level are passed down to the main process because only the renderer
 * knows them. Anything not measured renders as "not measured" rather than as a zero.
 */

const isElectron = typeof window !== 'undefined' && !!window.rama;

/** One `{value, source, measured}` fact. Unmeasured is shown as such, never as a blank or a 0. */
function Fact({ label, fact }) {
  if (!fact) return null;
  const measured = fact.measured && fact.value !== null && fact.value !== undefined;
  const shown = !measured
    ? 'not measured'
    : (fact.value === true ? 'yes' : fact.value === false ? 'no' : String(fact.value));

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 12,
      padding: '8px 0', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: 'right', minWidth: 0 }}>
        <span style={{
          fontSize: 12,
          color: measured ? 'var(--text)' : 'var(--muted)',
          fontStyle: measured ? 'normal' : 'italic',
        }}>
          {shown}
        </span>
        {/* The source is what makes the claim auditable, so it is always visible. */}
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
          {measured ? fact.source : (fact.why || fact.source)}
        </span>
      </span>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div className="hud-card" style={{ padding: '16px 20px' }}>
      <div className="section-label" style={{ marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

export default function SelfPanel() {
  const currentUser = useUserStore(s => s.currentUser);
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isElectron || !window.rama.self) {
      setError('The self-model is not available in this build.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Voice level is a live capability probe, so a failure here must not lose the whole panel.
      let voiceLevel = null;
      try {
        const v = await resolveVoiceCapability();
        if (Number.isInteger(v?.level)) voiceLevel = v.level;
      } catch { /* reports as unmeasured */ }

      const res = await window.rama.self.describe({
        user: currentUser,
        reflexSkills: SKILLS.length,
        voiceLevel,
      });
      if (res?.ok) setModel(res.data);
      else setError(res?.error || 'Could not describe self');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [currentUser]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="hud-card" style={{ padding: '16px 20px', maxWidth: 620 }}>
        <div style={{ fontSize: 12, color: 'var(--amber)' }}>{error}</div>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="hud-card" style={{ padding: '16px 20px', maxWidth: 620 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Measuring…</div>
      </div>
    );
  }

  const { identity, ability, experience, limits, summary, attestation } = model;

  return (
    <div style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── The one-paragraph answer ─────────────────────────────────────── */}
      <div className="hud-card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
          <div className="section-label">WHAT I AM</div>
          <button className="btn btn-sm" disabled={busy}
            onClick={load}
            style={{ marginLeft: 'auto', fontSize: 11.5 }}>
            {busy ? 'Measuring…' : '↺ Re-measure'}
          </button>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--text)' }}>
          {summary.text}
        </div>
      </div>

      {/* ── Limits FIRST. This is the half that gives the rest meaning. ───── */}
      <div className="hud-card" style={{ padding: '16px 20px' }}>
        <div className="section-label" style={{ marginBottom: 10 }}>
          WHAT I CANNOT DO {limits.length > 0 && `· ${limits.length}`}
        </div>

        {limits.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            Nothing I check for is currently missing. This is not a claim of completeness — it means
            every condition this panel knows how to test came back satisfied.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {limits.map((l, i) => (
              <div key={i} style={{
                paddingLeft: 12, borderLeft: '2px solid var(--amber)',
              }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                  {l.what}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.6 }}>
                  {l.why}
                </div>
                {l.fixable && (
                  <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4, lineHeight: 1.6 }}>
                    → {l.fixable}
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>
                  measured from {l.source}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <Group title="IDENTITY">
        <Fact label="Name"     fact={identity.name} />
        <Fact label="Version"  fact={identity.version} />
        <Fact label="Serves"   fact={identity.serves} />
        <Fact label="Loyalty"  fact={identity.loyalty} />
        <Fact label="Genome"   fact={identity.genome} />
        <Fact label="Packaged" fact={identity.packaged} />
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
          {attestation.loyalty}
        </div>
      </Group>

      {/* ── Ability ──────────────────────────────────────────────────────── */}
      <Group title="WHAT I CAN DO">
        <Fact label="Instant skills (no model)" fact={ability.reflexSkills} />
        <Fact label="Local model"               fact={ability.localModel} />
        <Fact label="Cloud model"               fact={ability.cloudModel} />
        <Fact label="Market engine"             fact={ability.marketEngine} />
        <Fact label="Voice level"               fact={ability.voiceLevel} />
        <Fact label="Gated capabilities"        fact={ability.gatedCapabilities} />
        <Fact label="Available to this account" fact={ability.capabilitiesForThisUser} />
        <Fact label="Projects known"            fact={ability.projectsKnown} />
      </Group>

      {/* ── Experience ───────────────────────────────────────────────────── */}
      <Group title="WHAT I HAVE DONE">
        <Fact label="Actions recorded"        fact={experience.recorded} />
        <Fact label="Answered with no model"  fact={experience.answeredWithoutAModel} />
        <Fact label="Escalated to a model"    fact={experience.escalatedToAModel} />
        <Fact label="Reflex rate"             fact={experience.reflexRate} />
        <Fact label="Failures"                fact={experience.failures} />
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
          Reflex rate is the share of turns answered without any model. It is the one number that
          would show Rāma getting cheaper and more capable over time — and it cannot rise until the
          tier-3 loop above is closed.
        </div>
      </Group>

      {/* ── The rule this panel is bound by ──────────────────────────────── */}
      <div className="hud-card" style={{ padding: '14px 20px' }}>
        <div className="section-label" style={{ marginBottom: 8 }}>HOW TO READ THIS</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.65 }}>
          {attestation.rule}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>
          Measured {new Date(attestation.generatedAt).toLocaleString()} from{' '}
          {attestation.sources.length} source{attestation.sources.length === 1 ? '' : 's'}
          {attestation.sources.length > 0 && `: ${attestation.sources.join(', ')}`}.
        </div>
      </div>
    </div>
  );
}
