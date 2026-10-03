#!/usr/bin/env node
/**
 * verifyMarketClock.mjs — the market state is DERIVED, and the suite is what stops it being claimed.
 *
 * WHAT THIS SUBSYSTEM IS FOR. Rāma has no tick stream, so "is the market live" cannot be answered by
 * observation. `marketClock.js` composes an answer from three facts that CAN be known — the published
 * IST session hours, the age of the newest stored bar, and when the last reply landed — and the whole
 * value of it is in the wording. So the wording is asserted here:
 *
 *   - NOTHING IS EVER NAMED `live`. Not a state, not a chip, not a composed sentence.
 *   - FIVE STATES, FIVE SENTENCES. `weekend` and `closed-for-the-day` are different facts and must not
 *     collapse into one, which is the flattening that hides a fault.
 *   - THE HOLIDAY BLIND SPOT IS A FIELD. Every state carries `holidayAware: false` and says a trading
 *     holiday will read as a session. A guessed calendar would be a confident wrong answer.
 *   - NOTHING READ IS NOT NOTHING HAPPENED. Zero bars reads `no bars to age`, never `up to date`; an
 *     unrecorded fetch reads `not recorded`, never `never fetched`.
 *   - STALENESS ONLY WHILE OPEN. Outside a session an old bar is the correct answer, and calling it
 *     stale would be a false alarm every weekend.
 *   - NO SECOND TIME VOCABULARY. Asserted at source level: no local offset arithmetic, no second
 *     chart-time converter, no second session-minutes figure.
 *
 * Every fixture is built from a UTC string, as `verifyChartSessions.mjs` does, so this suite gives the
 * same answer on master's machine in IST as it does anywhere else: 09:15 IST is 03:45 UTC and 15:30 IST
 * is 10:00 UTC. Assertion labels carry the plan's own numbering (plan.md item 9, 1-27).
 *
 * Run: node scripts/verifyMarketClock.mjs   (or npm run verify:market-clock)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  EXCHANGE_TZ, SESSION, istParts, sessionState, barAge, liveReading,
} from '../src/pages/StockMind/marketClock.js';
import { formatStamp, zoneLabel } from '../src/pages/StockMind/chartTime.js';
import { showsClock } from '../src/pages/StockMind/timeframes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SM = path.join(ROOT, 'src', 'pages', 'StockMind');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` - ${detail}` : ''}`); }
};
const read = (f) => {
  try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
};

// ── Fixtures ──────────────────────────────────────────────────────────────────
// 2026-09-17 is a Thursday, 18 a Friday, 19 a Saturday, 20 a Sunday, 21 a Monday.
const at = (s) => new Date(Date.parse(`${s}Z`));
const secs = (s) => Math.floor(Date.parse(`${s}Z`) / 1000);
const ms = (s) => Date.parse(`${s}Z`);

const OPEN_UTC = '2026-09-18T03:45:00';     // 09:15 IST
const CLOSE_UTC = '2026-09-18T10:00:00';    // 15:30 IST
const MID_UTC = '2026-09-18T06:00:00';      // 11:30 IST

const STATES = ['weekend', 'before-open', 'pre-open', 'open', 'closed-for-the-day'];
const sampleStates = {
  weekend: sessionState(at('2026-09-19T05:00:00')),
  'before-open': sessionState(at('2026-09-18T03:29:00')),
  'pre-open': sessionState(at('2026-09-18T03:44:00')),
  open: sessionState(at(OPEN_UTC)),
  'closed-for-the-day': sessionState(at('2026-09-18T10:01:00')),
};

console.log('\nmarket clock — derived from the schedule, and never called live\n');

// ── 1. The open boundary, from the IST side ───────────────────────────────────
console.log('  1. the regular session begins at 09:15 IST and the two minutes before it differ');
check('[1] 03:45 UTC on a Friday is open', sessionState(at(OPEN_UTC)).state === 'open',
  sessionState(at(OPEN_UTC)).state);
check('[1] 03:44 UTC is pre-open, not open',
  sessionState(at('2026-09-18T03:44:00')).state === 'pre-open');
check('[1] 03:29 UTC is before-open — the day has not started',
  sessionState(at('2026-09-18T03:29:00')).state === 'before-open');
check('[1] 03:30 UTC is the first minute of pre-open',
  sessionState(at('2026-09-18T03:30:00')).state === 'pre-open');
check('[1] the schedule is read from SESSION, not from a literal',
  SESSION.preOpenFrom === 540 && SESSION.open === 555 && SESSION.close === 930);
check('[1] the exchange zone is the exchange\'s, not the machine\'s',
  EXCHANGE_TZ === 'Asia/Kolkata');

// ── 2. The closing bar is in session ──────────────────────────────────────────
console.log('\n  2. 15:30 IST is still the session; the minute after it is not');
check('[2] 10:00 UTC is open — the closing bar belongs to the day',
  sessionState(at(CLOSE_UTC)).state === 'open');
check('[2] 10:01 UTC is closed-for-the-day',
  sessionState(at('2026-09-18T10:01:00')).state === 'closed-for-the-day');
check('[2] and open is the only state that reports open: true',
  STATES.filter((s) => sampleStates[s].open === true).join() === 'open');

// ── 3. A weekend is not a closed day ──────────────────────────────────────────
console.log('\n  3. Saturday and Sunday are a weekend, which is a different fact from a day that ran');
check('[3] Saturday is weekend', sessionState(at('2026-09-19T05:00:00')).state === 'weekend');
check('[3] Sunday is weekend', sessionState(at('2026-09-20T05:00:00')).state === 'weekend');
check('[3] a Saturday inside session hours is still the weekend, not open',
  sessionState(at('2026-09-19T06:00:00')).state === 'weekend');
check('[3] weekend and closed-for-the-day are different VALUES',
  sampleStates.weekend.state !== sampleStates['closed-for-the-day'].state);
check('[3] and different WORDS — neither sentence would do for the other',
  sampleStates.weekend.sentence !== sampleStates['closed-for-the-day'].sentence
  && /weekend/i.test(sampleStates.weekend.sentence)
  && !/weekend/i.test(sampleStates['closed-for-the-day'].sentence));
check('[3] their chips differ too, because the chip is all master sees first',
  sampleStates.weekend.chip !== sampleStates['closed-for-the-day'].chip);

// ── 4. Five states, five sentences ────────────────────────────────────────────
console.log('\n  4. each state carries its own sentence — "closed" for all four would hide a fault');
check('[4] pre-open and closed-for-the-day read differently',
  sampleStates['pre-open'].sentence !== sampleStates['closed-for-the-day'].sentence);
check('[4] all five sentences are distinct',
  new Set(STATES.map((s) => sampleStates[s].sentence)).size === 5);
check('[4] all five are non-empty prose',
  STATES.every((s) => typeof sampleStates[s].sentence === 'string'
    && sampleStates[s].sentence.trim().length > 30));
check('[4] all five phrases are distinct, and each names the market',
  new Set(STATES.map((s) => sampleStates[s].phrase)).size === 5
  && STATES.every((s) => /market/.test(sampleStates[s].phrase)));
check('[4] pre-open says it is not continuous trading',
  /not continuous trading/.test(sampleStates['pre-open'].sentence));

// ── 5. The holiday blind spot travels with every state ────────────────────────
console.log('\n  5. Rāma has no holiday calendar, so every state says a holiday will read as a session');
check('[5] every state carries holidayAware: false',
  STATES.every((s) => sampleStates[s].holidayAware === false));
check('[5] every state carries a caveat naming holidays',
  STATES.every((s) => sampleStates[s].caveats.some((c) => /holiday/i.test(c))));
check('[5] the caveat says the holiday will READ as a session rather than being skipped',
  STATES.every((s) => sampleStates[s].caveats.some((c) => /read as a session/i.test(c))));
check('[5] every state also says nothing is observed from the market',
  STATES.every((s) => sampleStates[s].caveats.some((c) => /no tick feed/i.test(c))));
check('[5] holidayAware is false on the composed reading too',
  liveReading({ interval: '30m', now: at(MID_UTC) }).holidayAware === false);
check('[5] and the reading carries the holiday caveat forward',
  liveReading({ interval: '30m', now: at(MID_UTC) }).caveats.some((c) => /holiday/i.test(c)));

// ── 6. The word that is never used ────────────────────────────────────────────
console.log('\n  6. nothing is named "live" — there is no feed, so the claim would be false');
const readings = [
  liveReading({ newest: secs('2026-09-18T05:18:00'), barCount: 10, interval: '30m', now: at(MID_UTC), fetchedAt: ms(MID_UTC) }),
  liveReading({ barCount: 0, interval: '30m', now: at(MID_UTC) }),
  liveReading({ newest: secs('2026-09-18T05:18:00'), barCount: 10, interval: '30m', now: at(MID_UTC), busy: true }),
  liveReading({ newest: '2026-09-18', barCount: 4, interval: '1d', now: at('2026-09-20T05:00:00') }),
  liveReading({ newest: 'not a date', barCount: 4, interval: '1d', now: at(MID_UTC) }),
  liveReading(null),
];
const LIVE = /\blive\b/i;
check('[6] no state value is "live"', !STATES.includes('live')
  && STATES.every((s) => sampleStates[s].state !== 'live'));
check('[6] no state sentence or caveat contains the standalone word',
  STATES.every((s) => !LIVE.test(sampleStates[s].sentence)
    && sampleStates[s].caveats.every((c) => !LIVE.test(c))));
check('[6] no composed reading contains it, in text, chip or caveat',
  readings.every((r) => !LIVE.test(r.text) && !LIVE.test(r.chip)
    && r.caveats.every((c) => !LIVE.test(c))));
check('[6] no tone is named for it either',
  readings.every((r) => ['open', 'pre-open', 'closed', 'unknown'].includes(r.tone)));
check('[6] and the module source says the state is derived',
  /DERIVED/.test(read(path.join(SM, 'marketClock.js'))));

// ── 7. A UTC midnight does not move the IST day ───────────────────────────────
console.log('\n  7. the boundaries hold on the IST side of a UTC midnight');
const beforeMidnight = at('2026-09-17T22:00:00');       // 03:30 IST Friday
check('[7] 22:00 UTC Thursday is 03:30 on the Friday in Kolkata',
  istParts(beforeMidnight).ymd === '2026-09-18' && istParts(beforeMidnight).clock === '03:30');
check('[7] and it reads before-open, on the Friday',
  sessionState(beforeMidnight).state === 'before-open');
check('[7] 18:30 UTC Thursday is IST midnight on the Friday',
  istParts(at('2026-09-17T18:30:00')).ymd === '2026-09-18'
  && istParts(at('2026-09-17T18:30:00')).clock === '00:00');
check('[7] 19:00 UTC Friday is already Saturday in Kolkata — the weekend',
  istParts(at('2026-09-18T19:00:00')).ymd === '2026-09-19'
  && sessionState(at('2026-09-18T19:00:00')).state === 'weekend');
check('[7] the weekday label comes from the exchange zone, not the machine',
  istParts(at('2026-09-18T19:00:00')).weekdayLabel === 'Sat'
  && istParts(at(OPEN_UTC)).weekdayLabel === 'Fri');

// ── 8. No zone assumption is smuggled in ──────────────────────────────────────
console.log('\n  8. every fixture is a UTC instant, so the answers do not depend on this machine');
check('[8] 03:45 UTC reads as 09:15 in the exchange zone',
  istParts(at(OPEN_UTC)).clock === '09:15' && istParts(at(OPEN_UTC)).minutes === SESSION.open);
check('[8] 10:00 UTC reads as 15:30',
  istParts(at(CLOSE_UTC)).clock === '15:30' && istParts(at(CLOSE_UTC)).minutes === SESSION.close);
check('[8] a January and a July instant both convert — India keeps no DST, and this proves it is '
  + 'not assumed by checking both',
  istParts(at('2026-01-15T03:45:00')).clock === '09:15'
  && istParts(at('2026-07-15T03:45:00')).clock === '09:15');
check('[8] istParts accepts a Date, epoch ms and a parsable string alike',
  istParts(at(OPEN_UTC)).clock === '09:15'
  && istParts(ms(OPEN_UTC)).clock === '09:15'
  && istParts(`${OPEN_UTC}Z`).clock === '09:15');
check('[8] istParts returns null for junk rather than throwing',
  istParts(null) === null && istParts(NaN) === null && istParts('not a date') === null
  && istParts({}) === null);

// ── 9-10. An intraday bar ages in minutes ─────────────────────────────────────
console.log('\n  9-10. an epoch bar ages in minutes, and one bar span is the current period');
const now30 = at(MID_UTC);
const bar42 = barAge(secs('2026-09-18T05:18:00'), { interval: '30m', now: now30 });
const bar12 = barAge(secs('2026-09-18T05:48:00'), { interval: '30m', now: now30 });
check('[9] a 30m bar 42 minutes old reports 42 minutes',
  bar42.unit === 'minutes' && bar42.age === 42, JSON.stringify(bar42));
check('[9] and is NOT the current period — 42 minutes is past a 30-minute bar',
  bar42.isCurrentPeriod === false);
check('[9] its text is the age in words, which is what the chip reads',
  bar42.text === '42 minutes old');
check('[10] a 30m bar 12 minutes old is inside the current bar',
  bar12.age === 12 && bar12.isCurrentPeriod === true);
check('[10] the span reported is the interval\'s own, from timeframes.js',
  bar42.span === 30 && barAge(secs('2026-09-18T05:48:00'), { interval: '5m', now: now30 }).span === 5);
check('[10] a bar one minute old reads in the singular',
  barAge(secs('2026-09-18T05:59:00'), { interval: '30m', now: now30 }).text === '1 minute old');

// ── 11-12. A daily bar is a calendar date ─────────────────────────────────────
console.log('\n  11-12. a daily bar ages in trading sessions and is never zone-shifted');
const today = barAge('2026-09-18', { interval: '1d', now: now30 });
const yesterday = barAge('2026-09-17', { interval: '1d', now: now30 });
check('[11] a daily bar dated today in IST is the current period',
  today.unit === 'sessions' && today.age === 0 && today.isCurrentPeriod === true,
  JSON.stringify(today));
check('[11] and it reads as dated today rather than "0 sessions old"',
  today.text === 'dated today');
check('[11] today is decided in the exchange zone — 22:00 UTC Thursday is Friday there',
  barAge('2026-09-18', { interval: '1d', now: beforeMidnight }).isCurrentPeriod === true);
check('[12] yesterday\'s daily bar is one trading session old',
  yesterday.age === 1 && yesterday.isCurrentPeriod === false
  && yesterday.text === '1 trading session old');
check('[12] a Friday bar read on the Monday is one session old, not three days',
  barAge('2026-09-18', { interval: '1d', now: at('2026-09-21T06:00:00') }).age === 1);
check('[12] a weekly bar\'s span is five sessions, taken from timeframes.js',
  barAge('2026-09-18', { interval: '1wk', now: now30 }).span === 5);

// ── 13-14. Staleness is claimed only while the session is open ────────────────
console.log('\n  13-14. an old bar outside a session is the expected answer, not a fault');
const stale3h = secs('2026-09-18T03:00:00');
check('[13] a 3-hour-old 30m bar is not called stale when the day has closed',
  barAge(stale3h, { interval: '30m', now: at('2026-09-18T10:30:00') }).stale === false);
check('[13] nor at the weekend, however old',
  barAge(secs('2026-09-18T05:00:00'), { interval: '30m', now: at('2026-09-20T05:00:00') })
    .stale === false);
check('[13] nor before the open',
  barAge(stale3h, { interval: '30m', now: at('2026-09-18T03:30:00') }).stale === false);
check('[13] nor in pre-open, which is not continuous trading',
  barAge(stale3h, { interval: '30m', now: at('2026-09-18T03:50:00') }).stale === false);
check('[14] but a bar older than two 30m spans IS stale while open',
  barAge(secs('2026-09-18T04:30:00'), { interval: '30m', now: now30 }).stale === true);
check('[14] and one inside two spans is not — 42 minutes is under an hour',
  bar42.stale === false && bar42.sessionOpen === true);

// ── 15. Junk ages to nothing, and does not throw ──────────────────────────────
console.log('\n  15. a bar time that cannot be read has no age, and says so rather than throwing');
check('[15] barAge(null) is null', barAge(null) === null);
check('[15] barAge(NaN) is null', barAge(NaN) === null);
check('[15] barAge(\'not a date\') is null', barAge('not a date') === null);
check('[15] a valid bar with an unknown interval is null — an age with no span is half an answer',
  barAge(secs(MID_UTC), { interval: 'nonsense', now: now30 }) === null);
check('[15] an object, an array and a boolean are all null',
  barAge({}, { interval: '30m', now: now30 }) === null
  && barAge([], { interval: '30m', now: now30 }) === null
  && barAge(true, { interval: '30m', now: now30 }) === null);
check('[15] a malformed date string is null, not a business day',
  barAge('2026-9-8', { interval: '1d', now: now30 }) === null);

// ── 16. Nothing read is not nothing happened ──────────────────────────────────
console.log('\n  16. zero bars reads as no bars to age, and never as up to date');
const noBars = liveReading({ barCount: 0, interval: '30m', now: now30, fetchedAt: ms(MID_UTC) });
check('[16] the reading says there is nothing to age',
  /no bars to age/.test(noBars.text), noBars.text);
check('[16] and never that anything is up to date',
  !/up to date/i.test(noBars.text) && noBars.caveats.every((c) => !/up to date/i.test(c)));
check('[16] a caveat says it is a gap in what Rāma holds, not a quiet market',
  noBars.caveats.some((c) => /not a quiet market/i.test(c)));
check('[16] the age object is null rather than a zero that would read as fresh',
  noBars.age === null);
check('[16] bars loaded but undateable reads as unknown, not as zero',
  /cannot be dated/.test(liveReading({
    newest: 'not a date', barCount: 9, interval: '1d', now: now30,
  }).text));

// ── 17. An unrecorded fetch is not an absent one ──────────────────────────────
console.log('\n  17. a null fetchedAt reads as not recorded, never as never fetched');
const noFetch = liveReading({ newest: secs('2026-09-18T05:18:00'), barCount: 10, interval: '30m', now: now30 });
check('[17] the reading says the fetch was not recorded this session',
  /last fetch not recorded this session/.test(noFetch.text), noFetch.text);
check('[17] and never says never fetched',
  !/never fetched/i.test(noFetch.text)
  && noFetch.caveats.every((c) => !/never fetched/i.test(c)));
check('[17] a caveat states it does not mean no fetch happened',
  noFetch.caveats.some((c) => /does not mean no fetch ever happened/i.test(c)));
check('[17] the fetch object reports recorded: false rather than a time',
  noFetch.fetch.recorded === false && noFetch.fetch.at === null);
check('[17] a negative or zero fetchedAt is treated as unrecorded, not as 1970',
  /not recorded/.test(liveReading({ barCount: 1, interval: '30m', now: now30, fetchedAt: -5 }).text)
  && /not recorded/.test(liveReading({ barCount: 1, interval: '30m', now: now30, fetchedAt: 0 }).text));

// ── 18. In flight is not freshness ────────────────────────────────────────────
console.log('\n  18. a fetch in flight is reported as in flight, and claims nothing about freshness');
const busyRead = liveReading({
  newest: secs('2026-09-18T05:18:00'), barCount: 10, interval: '30m', now: now30,
  busy: true, fetchedAt: ms(MID_UTC),
});
check('[18] the reading says a fetch is in flight', /a fetch is in flight now/.test(busyRead.text),
  busyRead.text);
check('[18] and does not also claim a landing time — the reply has not arrived',
  !/last fetched/.test(busyRead.text));
check('[18] nor does it claim freshness in any other wording',
  !/up to date/i.test(busyRead.text) && !/current data/i.test(busyRead.text));
check('[18] the bar age is still reported, because that fact is unaffected',
  /newest 30m bar is 42 minutes old/.test(busyRead.text));
check('[18] and the fetch object marks busy',
  busyRead.fetch.busy === true);

// ── 19. The one plain reading ─────────────────────────────────────────────────
console.log('\n  19. the three facts compose into one sentence master can read at a glance');
const full = liveReading({
  newest: secs('2026-09-18T05:18:00'), barCount: 10, interval: '30m', now: now30,
  busy: false, fetchedAt: ms(MID_UTC),
});
check('[19] an open session with a 42-minute-old 30m bar reads as the plan specified',
  /market open · newest 30m bar is 42 minutes old · last fetched \d\d:\d\d/.test(full.text),
  full.text);
check('[19] the chip is the short form of the same state',
  full.chip === 'open' && full.state === 'open' && full.tone === 'open');
check('[19] the full session sentence travels with it for the title',
  typeof full.sentence === 'string' && full.sentence.includes('15:30'));
check('[19] a daily chart at the weekend reads in its own words — Friday\'s bar is the latest there '
  + 'is, and is not called a day old',
  /market closed for the weekend · newest 1D bar is from the most recent session/.test(liveReading({
    newest: '2026-09-18', barCount: 50, interval: '1d', now: at('2026-09-19T06:00:00'),
  }).text));
check('[19] and on the Monday morning the same bar is one session old',
  /newest 1D bar is 1 trading session old/.test(liveReading({
    newest: '2026-09-18', barCount: 50, interval: '1d', now: at('2026-09-21T06:00:00'),
  }).text));
check('[19] a bar inside the current period says so rather than implying lateness',
  /still the current bar/.test(liveReading({
    newest: secs('2026-09-18T05:48:00'), barCount: 10, interval: '30m', now: now30,
  }).text));

// ── 20. Every stamp goes through formatStamp, and is named ────────────────────
console.log('\n  20. the fetch stamp is chartTime.js\'s, and carries the zone when a clock is shown');
const clock = (/(\d{2}:\d{2})(?!.*\d{2}:\d{2})/.exec(formatStamp(secs(MID_UTC))) || [])[1];
const zone = zoneLabel();
check('[20] the clock in the reading is the one formatStamp produced',
  typeof clock === 'string' && clock.length === 5 && full.text.includes(`last fetched ${clock}`),
  `${clock} vs ${full.text}`);
check('[20] and it carries zoneLabel() on an intraday interval, because a bare time is ambiguous',
  showsClock('30m') && (zone ? full.text.includes(`${clock} ${zone}`) : true));
check('[20] a daily interval shows no zone label — a date needs none',
  !/GMT|UTC/.test(liveReading({
    newest: '2026-09-18', barCount: 5, interval: '1d', now: now30, fetchedAt: ms(MID_UTC),
  }).text) || !showsClock('1d'));
check('[20] a fetch from an earlier day shows the whole stamp, not a bare clock',
  liveReading({
    newest: secs('2026-09-18T05:18:00'), barCount: 10, interval: '30m', now: now30,
    fetchedAt: ms('2026-09-17T06:00:00'),
  }).text.includes(`last fetched ${formatStamp(secs('2026-09-17T06:00:00'))}`));
check('[20] the fetch time is carried as epoch seconds, the unit chartTime.js speaks',
  full.fetch.at === Math.floor(ms(MID_UTC) / 1000));

// ── 21. Nothing renders as undefined ──────────────────────────────────────────
console.log('\n  21. every branch returns words — a chip that renders as undefined is the worst case');
const branches = [
  liveReading({ barCount: 0, interval: '30m', now: now30 }),
  liveReading({ newest: secs(MID_UTC), barCount: 1, interval: '30m', now: now30, busy: true }),
  liveReading({ newest: '2026-09-18', barCount: 1, interval: '1d', now: now30, fetchedAt: ms(MID_UTC) }),
  liveReading({ newest: 'junk', barCount: 1, interval: '1d', now: now30 }),
  liveReading({ newest: secs(MID_UTC), barCount: 1, interval: 'nonsense', now: now30 }),
  liveReading({ newest: secs(MID_UTC), barCount: 1, interval: '30m', now: 'not a date' }),
  liveReading({ barCount: 0, interval: '30m', now: at('2026-09-20T05:00:00') }),
  liveReading({}),
];
check('[21] every branch returns a non-empty text string',
  branches.every((r) => typeof r.text === 'string' && r.text.trim().length > 0));
check('[21] every branch returns a non-empty chip',
  branches.every((r) => typeof r.chip === 'string' && r.chip.trim().length > 0));
check('[21] no text contains the word undefined, null or NaN',
  branches.every((r) => !/undefined|\bnull\b|NaN/.test(r.text)), branches.map((r) => r.text).join(' | '));
check('[21] every branch returns a caveat array with the holiday caveat in it',
  branches.every((r) => Array.isArray(r.caveats) && r.caveats.some((c) => /holiday/i.test(c))));
check('[21] an unreadable clock degrades to the unknown state rather than guessing one',
  liveReading({ barCount: 1, interval: '30m', now: 'not a date' }).state === 'unknown'
  && liveReading({ barCount: 1, interval: '30m', now: 'not a date' }).tone === 'unknown');
check('[21] and the unknown state says it will not assume a session',
  /will not say/.test(liveReading({ barCount: 1, interval: '30m', now: 'not a date' }).sentence));

// ── 22. Junk in, a usable object out ──────────────────────────────────────────
console.log('\n  22. this runs inside a render, so junk returns an object rather than throwing');
const junk = [null, undefined, {}, [], 'x', 42, true].map((v) => liveReading(v));
check('[22] every junk argument returns an object with the five documented keys',
  junk.every((r) => r && typeof r === 'object' && typeof r.state === 'string'
    && typeof r.tone === 'string' && typeof r.chip === 'string' && typeof r.text === 'string'
    && Array.isArray(r.caveats)));
check('[22] a junk argument still reads as no bars to age',
  junk.every((r) => /no bars to age/.test(r.text)));
check('[22] a negative barCount is zero bars, not a negative age',
  /no bars to age/.test(liveReading({ barCount: -5, interval: '30m', now: now30 }).text));
check('[22] sessionState survives junk too, with its caveats intact',
  sessionState('nonsense').state === 'unknown'
  && sessionState('nonsense').caveats.some((c) => /holiday/i.test(c))
  && sessionState(null).holidayAware === false);
check('[22] barAge survives an explicitly null options object',
  barAge(secs(MID_UTC), null) === null);

// ── 23. No second time vocabulary (D6) ────────────────────────────────────────
console.log('\n  23. one time vocabulary: chartTime.js for stamps, timeframes.js for spans');
const clockSrc = read(path.join(SM, 'marketClock.js'));
check('[23] marketClock.js imports formatStamp and zoneLabel from chartTime.js',
  /import \{\s*formatStamp, zoneLabel\s*\} from '\.\/chartTime\.js'/.test(clockSrc));
check('[23] and takes its spans from timeframes.js, SESSION_MINUTES included',
  /from '\.\/timeframes\.js'/.test(clockSrc) && /SESSION_MINUTES/.test(clockSrc));
check('[23] no getTimezoneOffset — the zone comes from Intl, which knows about Kolkata',
  !/getTimezoneOffset/.test(clockSrc));
check('[23] no second chart-time converter', !/toChartTime/.test(clockSrc));
check('[23] no second session-minutes figure', !/\b375\b/.test(clockSrc));
check('[23] the IST conversion is Intl.DateTimeFormat parts',
  /new Intl\.DateTimeFormat\(/.test(clockSrc) && /formatToParts\(/.test(clockSrc));
check('[23] and a bad zone or date is caught rather than thrown, as chartTime.js does',
  /} catch \{/.test(clockSrc));

// ── 24. The chart renders the composed reading, not its own sentence ──────────
console.log('\n  24. PriceChart.jsx paints the words; it does not compose them');
const chart = read(path.join(SM, 'PriceChart.jsx'));
check('[24] the chart imports marketClock.js',
  /import \{ liveReading \} from '\.\/marketClock\.js'/.test(chart));
check('[24] and calls liveReading once, in a memo',
  (chart.match(/liveReading\(/g) || []).length === 1 && /useMemo\(\(\) => liveReading\(/.test(chart));
check('[24] the composed text is rendered, in the title and in the readout row',
  (chart.match(/marketLive\.text/g) || []).length >= 2);
check('[24] the caveats are rendered where a canvas\'s facts go for assistive technology',
  /marketLive\.caveats\.join\(' '\)/.test(chart)
  && chart.indexOf('marketLive.caveats.join(\' \')') > chart.indexOf('aria-live="polite"'));
check('[24] the chip is the module\'s chip and the colour is the module\'s tone',
  /marketLive\.chip/.test(chart) && /MARKET_TONE\[marketLive\.tone\]/.test(chart));
check('[24] the schedule itself is not restated in the renderer — no session minute literal, and '
  + 'only the composed reading is imported',
  !/\b(540|555|930)\b/.test(chart)
  && !/import \{[^}]*\bSESSION\b[^}]*\} from '\.\/marketClock\.js'/.test(chart)
  && !/sessionState\(/.test(chart) && !/barAge\(/.test(chart));
check('[24] green is reserved for the open session alone',
  /open: 'var\(--green\)'/.test(chart) && /closed: 'var\(--muted\)'/.test(chart)
  && /unknown: 'var\(--muted\)'/.test(chart));

// ── 25. It draws at all three call sites ──────────────────────────────────────
console.log('\n  25. the chip needs only props that default, so all three charts show it');
const header = chart.slice(chart.indexOf('{busy && <span'), chart.indexOf('<span style={{ flex: 1 }} />'));
const page = read(path.join(SM, 'StockMind.jsx'));
const popout = read(path.join(SM, 'PopoutPanel.jsx'));
check('[25] fetchedAt is optional and defaults to null (I11)', /fetchedAt = null,/.test(chart));
check('[25] the chip sits in the identity header, after the loading span',
  header.includes('marketLive.chip') && header.includes('InfoTip id="marketState"'));
check('[25] and is not gated on any prop that has no default',
  !/projectionMeta/.test(header) && !/onHorizonBars/.test(header) && !/cone\?\./.test(header));
check('[25] the reading is memoised on defaulting props only',
  /\}\), \[candles, interval, busy, fetchedAt\]\);/.test(chart));
check('[25] StockMind.jsx passes fetchedAt at both of its call sites',
  (page.match(/fetchedAt=\{barsFetchedAt\}/g) || []).length === 2);
check('[25] and records it on a reply that arrived, not on a failure',
  /if \(res\?\.ok\) setBarsFetchedAt\(Date\.now\(\)\);/.test(page));
check('[25] PopoutPanel.jsx records its own, because it refreshes itself',
  /setFetchedAt\(Date\.now\(\)\);/.test(popout) && /fetchedAt=\{fetchedAt\}/.test(popout));
check('[25] no call site is required to pass it — the prop list still has no required member',
  !/fetchedAt,\s*\/\/ required/.test(chart));

// ── 26. One InfoTip, one glossary term ────────────────────────────────────────
console.log('\n  26. the chip carries the glossary term FEAT-001 defined');
const glossary = read(path.join(SM, 'glossary.js'));
check('[26] exactly one InfoTip names marketState',
  (chart.match(/id="marketState"/g) || []).length === 1);
check('[26] and the term exists in the glossary', /\n  marketState: \{/.test(glossary));
check('[26] the term itself says the state is derived and never claimed',
  /never claims to be live/.test(glossary));

// ── 27. The gates that keep every tranche honest ──────────────────────────────
console.log('\n  27. no debug logging, no placeholder, no new dependency');
const pkg = read(path.join(ROOT, 'package.json'));
check('[27] no console.log in the new module or the chart',
  !/console\.log/.test(clockSrc) && !/console\.log/.test(chart));
check('[27] no TODO or FIXME in either', !/TODO|FIXME/.test(clockSrc) && !/TODO|FIXME/.test(chart));
check('[27] nothing reads as not implemented', !/not implemented/i.test(clockSrc));
check('[27] package.json has a verify:market-clock script',
  /"verify:market-clock": "node scripts\/verifyMarketClock\.mjs"/.test(pkg));
check('[27] and the verify chain runs it after the projection suite',
  /verifyChartProjection\.mjs && node scripts\/verifyMarketClock\.mjs/.test(pkg));
check('[27] lightweight-charts is still pinned and no dependency was added',
  /"lightweight-charts": "5\.2\.1"/.test(pkg) && !/[\^~]\d/.test(pkg));
check('[27] and no third series primitive was added — the sessions suite pins the count at two',
  (chart.match(/attachPrimitive\(/g) || []).length === 2);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
