import React, { useMemo, useRef, useState } from 'react';
import ScreenMap, { SCREEN_IDS, screenMap } from './ScreenMap.jsx';
import { GROUPS, TERMS, searchTerms, term, termsInGroup } from './glossary.js';

/**
 * HelpPanel — the info screen master asked for (spec Section 104).
 *
 * Master: *"does the stock mind screen give any info on each and every field so that user can
 * understand it? If no, then start making screens simpler by dividing various functionalities grouped
 * as needed. Also develop an info screen with all the related info needed for understanding
 * functionality, include the stockmind related screenshots and explain the terminology."*
 *
 * The honest answer to the first question was NO, and it is recorded as such in Section 104: roughly a
 * third of fields carried a hover `title`, the rest carried nothing, and several of the most
 * consequential were bare jargon.
 *
 * FOUR LAYERS, and they are deliberately in this order:
 *   1. START HERE — what the module is for, and what it will not do. Two minutes.
 *   2. SCREEN BY SCREEN — annotated layout maps with numbered callouts.
 *   3. GLOSSARY — every term, searchable, grouped.
 *   4. LIMITS — what cannot be measured and why, in one place.
 *
 * Layer 4 exists separately because the limits are scattered across the product by necessity — the
 * news badge, the unbacktestable blocks, the acceptance gate — and a user who has met one of them
 * deserves to find the rest without hunting.
 *
 * THE MAPS ARE SCHEMATICS, NOT SCREENSHOTS, and the panel says so where master will see it. Reasons in
 * `ScreenMap.jsx`: a capture cannot be taken from inside the renderer without a running window, it
 * goes stale on the next restyle with nothing able to notice, and it cannot carry callouts.
 */

const SECTIONS = [
  { id: 'start',    label: 'Start here' },
  { id: 'screens',  label: 'Screen by screen' },
  { id: 'glossary', label: 'Glossary' },
  { id: 'limits',   label: 'What it will not do' },
];

function H({ children }) {
  return (
    <div className="section-label" style={{ marginBottom: '8px' }}>{children}</div>
  );
}

function P({ children, wide }) {
  return (
    <p style={{ fontSize: '12.5px', lineHeight: 1.75, color: 'var(--text-dim, var(--muted))',
      maxWidth: wide ? 'none' : '80ch', margin: '0 0 10px' }}>
      {children}
    </p>
  );
}

function Step({ n, title, children }) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
      <span aria-hidden="true" style={{
        flexShrink: 0, width: '20px', height: '20px', borderRadius: '50%',
        background: 'var(--accent)', color: '#06080c', fontSize: '11.5px', fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{n}</span>
      <div style={{ fontSize: '12.5px', lineHeight: 1.75 }}>
        <strong style={{ color: 'var(--text)' }}>{title}</strong>
        <div style={{ color: 'var(--text-dim, var(--muted))' }}>{children}</div>
      </div>
    </div>
  );
}

export default function HelpPanel() {
  const [section, setSection] = useState('start');
  const [screen, setScreen] = useState(SCREEN_IDS[0]);
  const [query, setQuery] = useState('');
  const [focusTerm, setFocusTerm] = useState(null);
  const glossaryRef = useRef(null);

  const hits = useMemo(() => searchTerms(query), [query]);

  // Following a `glossary →` link from a screen map jumps to the glossary and pins the term open,
  // rather than leaving master to find it in a list of a hundred.
  const goToTerm = (id) => {
    setQuery('');
    setFocusTerm(id);
    setSection('glossary');
    setTimeout(() => glossaryRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }} role="tablist"
           aria-label="Help sections">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id}
                  onClick={() => setSection(s.id)}
                  style={{
                    padding: '5px 12px', fontSize: '12.5px', cursor: 'pointer', borderRadius: '4px',
                    border: `1px solid ${section === s.id ? 'var(--accent)' : 'var(--border)'}`,
                    background: section === s.id
                      ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'transparent',
                    color: section === s.id ? 'var(--accent)' : 'var(--muted)',
                    fontWeight: section === s.id ? 700 : 400,
                  }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── 1. Start here ─────────────────────────────────────────────────── */}
      {section === 'start' && (
        <>
          <div className="hud-card" style={{ padding: '16px' }}>
            <H>WHAT STOCKMIND IS</H>
            <P>
              A research tool for your own trading. It fetches and stores price history, draws it,
              computes readings from it, tracks the positions you tell it about, and lets you build and
              test rules. It is <strong>not</strong> a broker, an adviser, or an autopilot.
            </P>
            <P>
              The one idea worth carrying into every screen: <strong>Rāma would rather tell you a
              number is unreliable than show you a confident one it cannot support.</strong> That is why
              you will see badges like MOCK DATA and NOT BACKTESTABLE, why a strategy can be refused
              rather than scored, and why several readings are shown but explicitly not acted on. None
              of those are faults.
            </P>
          </div>

          <div className="hud-card" style={{ padding: '16px', display: 'flex',
            flexDirection: 'column', gap: '12px' }}>
            <H>FIVE MINUTES, START TO FINISH</H>
            <Step n={1} title="Pick an instrument and load its history">
              Open the INSTRUMENT dropdown at the top. A ● means Rāma already has bars for it and the
              chart will draw immediately. Otherwise press <strong>⇩ Fetch from provider</strong> once
              — it pulls as much history as free data allows and keeps it on disk.
            </Step>
            <Step n={2} title="Choose what you are asking about">
              On the chart, the interval row says how much time one bar covers and the window row says
              how far back to look. Minute bars answer "what is happening this session"; daily and
              weekly bars answer "what is this doing this year".
            </Step>
            <Step n={3} title="Set the money before you ask for anything">
              CAPITAL and RISK % decide every currency figure on the screen. The line under RISK %
              shows the money actually at stake per trade. If losing it would change your decisions,
              the percentage is too high.
            </Step>
            <Step n={4} title="Ask for signals, or build a strategy">
              <strong>⚡ Generate Signals</strong> gives one reading of this instrument now, with entry,
              stop and targets. The <strong>STRATEGY</strong> tab is the other question entirely: a
              rule tested over years, with a verdict on whether the result is distinguishable from
              luck.
            </Step>
            <Step n={5} title="Record what you actually trade">
              YOUR BOOK is the only way Rāma can watch your stops, your holding periods and your
              concentration — and the only way the chart can mark where you got in. Include the stop
              and the reason; without them, "was I right or lucky?" has no answer later.
            </Step>
          </div>

          <div className="hud-card" style={{ padding: '16px' }}>
            <H>THE ONE DISTINCTION TO KEEP STRAIGHT</H>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
              gap: '14px' }}>
              <div>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text)',
                  marginBottom: '4px' }}>A signal</div>
                <P>
                  One reading of one instrument, right now. Produced on request, never in the
                  background, because a stale entry price is worse than none. Several rows for one
                  symbol are different risk geometries over <strong>one</strong> prediction.
                </P>
              </div>
              <div>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text)',
                  marginBottom: '4px' }}>A strategy</div>
                <P>
                  A rule you could have followed for years. Tested over stored history, with the last
                  slice withheld from the search, costs always applied, and the result measured against
                  what searching that many variants would have produced from pure luck.
                </P>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── 2. Screen by screen ───────────────────────────────────────────── */}
      {section === 'screens' && (
        <div className="hud-card" style={{ padding: '16px' }}>
          <H>SCREEN BY SCREEN</H>
          <P>
            Each map mirrors the real arrangement of the real screen, with numbered callouts beneath
            it. <strong>These are schematics, not screen captures</strong> — a capture cannot be taken
            from inside the app without a running window, it goes stale on the next restyle with
            nothing able to notice, and it cannot carry callouts. A schematic can be wrong in the same
            way a comment can be wrong, and it lives beside the code it describes.
          </P>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', margin: '10px 0 14px' }}>
            {SCREEN_IDS.map((id) => (
              <button key={id} type="button" onClick={() => setScreen(id)}
                      aria-pressed={screen === id}
                      style={{
                        padding: '4px 11px', fontSize: '12px', cursor: 'pointer', borderRadius: '4px',
                        border: `1px solid ${screen === id ? 'var(--accent)' : 'var(--border)'}`,
                        background: screen === id
                          ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'transparent',
                        color: screen === id ? 'var(--accent)' : 'var(--muted)',
                        letterSpacing: '0.06em',
                      }}>
                {screenMap(id)?.title || id}
              </button>
            ))}
          </div>
          <ScreenMap id={screen} onTerm={goToTerm} />
        </div>
      )}

      {/* ── 3. Glossary ───────────────────────────────────────────────────── */}
      {section === 'glossary' && (
        <div className="hud-card" style={{ padding: '16px' }} ref={glossaryRef}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
            marginBottom: '10px' }}>
            <H>GLOSSARY</H>
            <span style={{ flex: 1 }} />
            <input className="input" style={{ width: '260px' }} value={query}
                   placeholder={`search ${Object.keys(TERMS).length} terms`}
                   aria-label="Search the glossary"
                   onChange={(e) => { setQuery(e.target.value); setFocusTerm(null); }} />
          </div>

          {focusTerm && term(focusTerm) && (
            <div style={{ border: '1px solid var(--accent)', borderRadius: 'var(--radius)',
              padding: '10px 12px', marginBottom: '12px',
              background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
                {term(focusTerm).term}
              </div>
              <P>{term(focusTerm).long}</P>
              <button type="button" className="btn btn-sm" onClick={() => setFocusTerm(null)}>
                clear
              </button>
            </div>
          )}

          {query ? (
            hits.length === 0 ? (
              <P>
                Nothing matches “{query}”. The glossary covers the terms StockMind itself uses; for
                general trading vocabulary it is not the right reference.
              </P>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {hits.map((t) => (
                  <div key={t.id}>
                    <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text)' }}>
                      {t.term}
                      <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '12px' }}>
                        {' '}· {GROUPS.find((g) => g.id === t.group)?.label || t.group}
                      </span>
                    </div>
                    <P>{t.long}</P>
                  </div>
                ))}
              </div>
            )
          ) : (
            GROUPS.map((g) => {
              const items = termsInGroup(g.id);
              if (items.length === 0) return null;
              return (
                <details key={g.id} open={g.id === 'concepts'} style={{ marginBottom: '8px' }}>
                  <summary style={{ cursor: 'pointer', fontSize: '12.5px', fontWeight: 700,
                    color: 'var(--text)', padding: '4px 0' }}>
                    {g.label}
                    <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · {items.length}</span>
                  </summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '9px',
                    padding: '6px 0 6px 12px', borderLeft: '1px solid var(--border)' }}>
                    {items.map((t) => (
                      <div key={t.id}>
                        <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text)' }}>
                          {t.term}
                        </div>
                        <P>{t.long}</P>
                        {(t.seeAlso || []).length > 0 && (
                          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                            see also:{' '}
                            {t.seeAlso.map((sid, i) => (
                              <React.Fragment key={sid}>
                                {i > 0 && ', '}
                                <button type="button" onClick={() => goToTerm(sid)}
                                        style={{ background: 'none', border: 'none', padding: 0,
                                          color: 'var(--accent)', cursor: 'pointer', font: 'inherit' }}>
                                  {term(sid)?.term || sid}
                                </button>
                              </React.Fragment>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              );
            })
          )}
        </div>
      )}

      {/* ── 4. Limits ─────────────────────────────────────────────────────── */}
      {section === 'limits' && (
        <>
          <div className="hud-card" style={{ padding: '16px', borderColor: 'var(--amber)' }}>
            <H>WHAT STOCKMIND WILL NOT DO</H>
            <P>
              These are permanent design decisions, not features waiting to be built. They are in one
              place because you will meet them one at a time across the product, and it is easier to
              trust a limit you can see the whole of.
            </P>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', lineHeight: 1.85,
              color: 'var(--text-dim, var(--muted))' }}>
              <li>
                <strong style={{ color: 'var(--text)' }}>It never places, changes or cancels a
                trade.</strong> Not now and not later. It reads, analyses and reports; the generated
                Python prints signals and sizes and places nothing. Every decision stays yours.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>It does not give financial advice.</strong> A
                grade of A+ is the engine's own confidence band on its own arithmetic, not a
                recommendation, and the disclaimer at the foot of every screen is not boilerplate.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>It does not connect to your broker.</strong>
                Your book is what you record. Reading trades from an installed trading application is
                a separate capability from placing them, and only reading would ever be built.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>It does not stream live prices.</strong>
                Everything is marked against stored history. A price that has fallen behind is flagged
                amber rather than presented as current.
              </li>
            </ul>
          </div>

          <div className="hud-card" style={{ padding: '16px' }}>
            <H>WHAT CANNOT BE MEASURED, AND WHY</H>
            <P>
              Four honest gaps. In each case Rāma shows the thing and refuses to score it, rather than
              scoring it and being quietly wrong.
            </P>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
              {[
                ['News and sentiment', 'newsNotBacktestable',
                  'No free news feed carries enough history to measure whether tone predicts anything. '
                  + 'News is shown as context and refused by the backtest. The NEWS panel carries a '
                  + 'NOT BACKTESTABLE badge for exactly this reason.'],
                ['Model probability inside a backtest', 'lookAhead',
                  'The trained model was fitted on data that includes the period a backtest would test '
                  + 'it over, so any result would be look-ahead — and it would be the most flattering '
                  + 'number in the tool. The block is usable in a live strategy and refused by the '
                  + 'backtest. Making it honest needs the model refitted inside every fold, which is '
                  + 'real work and is not pretended.'],
                ['Probabilities while no model has cleared the gate', 'acceptanceGate',
                  'Directional readings are shown, because hiding them would hide that they exist, and '
                  + 'they are not acted on. Warnings that depend on no model — a breached stop, an '
                  + 'overheld intraday position — are unaffected and stay live.'],
                ['Depth of intraday history', 'providerCap',
                  'Free data gives about 5 days of 1-minute bars, one month of 5 to 30-minute bars and '
                  + 'two years of hourly. This is the provider\'s limit, not Rāma\'s, and the windows '
                  + 'beyond it are not offered rather than offered and failing.'],
              ].map(([title, termId, body]) => (
                <div key={title}>
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--amber)' }}>
                    {title}
                  </div>
                  <P>{body}</P>
                  <button type="button" onClick={() => goToTerm(termId)}
                          style={{ background: 'none', border: 'none', padding: 0,
                            color: 'var(--accent)', cursor: 'pointer', font: 'inherit',
                            fontSize: '12px' }}>
                    glossary: {term(termId)?.term} →
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="hud-card" style={{ padding: '16px' }}>
            <H>THE THREE THINGS THAT MAKE A BACKTEST HONEST HERE</H>
            <P>
              Worth knowing even if you never open the STRATEGY tab, because they are why a result from
              this tool will usually look worse than one from a tool that does not do them.
            </P>
            <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', lineHeight: 1.85,
              color: 'var(--text-dim, var(--muted))' }}>
              <li>
                <strong style={{ color: 'var(--text)' }}>Costs are always applied.</strong> Commission,
                slippage and spread on every round trip, never zero by default. A strategy profitable
                only gross is not a strategy.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Entry is on the next bar's open.</strong> A
                signal computed from a bar's close cannot be acted on at that close. Filling at the
                signal bar is the commonest overstatement in backtesting, and on a breakout rule it is
                most of the apparent edge.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>The result is measured against luck, not
                against zero.</strong> Search a thousand variants and the best will look excellent
                whether or not any edge exists. Rāma computes what that many tries would produce from
                pure noise and requires the result to beat it — so a wider search makes a result harder
                to believe, not easier.
              </li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
