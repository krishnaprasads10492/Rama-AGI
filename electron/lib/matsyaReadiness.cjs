'use strict';

/**
 * matsyaReadiness.cjs — is there actually a backup, and does master need to do anything?
 * (Section 204)
 *
 * WHY THIS SHAPE. Master's instruction was to integrate Matsya into Rāma's capabilities without
 * making work for him. The way to do that is not another command: it is for Rāma to NOTICE, and to
 * say so where he already looks.
 *
 * So this returns entries in the shape `startupDoctor.diagnose()` already uses — `{ id, detail,
 * remedy }` — which means the answer appears in the startup diagnosis, which `health:startup`
 * already returns and `HealthPanel` already renders. No new page, no new habit, nothing to remember.
 *
 * ONE IRREDUCIBLE HUMAN ACT. Everything here can be automated except writing the phrase on paper.
 * 192.5 was decided that way on purpose: a key the machine keeps dies with the machine. So the only
 * entry that asks anything of master is the one that cannot be done for him, and it says exactly
 * what to do in one line.
 *
 * DEGRADED, NOT FATAL — always. A missing backup is not a reason to refuse to start; it is a reason
 * to say something. Classifying it as fatal would make Rāma unusable to protect data it is not yet
 * protecting, which is the wrong trade in both directions.
 *
 * WHERE THE WIRING IS EXPLAINED, and why not at the wiring. `startupDoctor.cjs` reads
 * `ctx.backup.degraded` and `ctx.backup.report` in four lines with no comment on them, because that
 * file's comment ceiling in `verifyCommentCensus` is frozen and may only fall — the census exists to
 * push reasoning out of files and into the spec rather than have it repeated in both. So: the facts
 * are PASSED IN rather than gathered there, which is what keeps `diagnose()` free of the disk and
 * lets a suite describe a machine nobody owns. The rest is Section 204.
 *
 * PURE: no clock of its own, no filesystem, no snapshot reading. Facts in, judgement out.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How old a snapshot may be before it is worth mentioning. A week: long enough not to nag. */
const STALE_AFTER_DAYS = 7;

/**
 * @param {object} facts
 * @param {boolean} facts.phraseRecorded   has a recovery phrase been generated and recorded
 * @param {string|null} facts.phraseFingerprint
 * @param {string|null} facts.lastSnapshotAt  ISO string, or null if none has ever been taken
 * @param {object|null} facts.destination     the result of matsyaDestination.choose()
 * @param {number} [facts.now]                ms, injected
 * @param {number} [facts.staleAfterDays]
 * @returns {{ready:boolean, degraded:Array, report:Array, ageDays:number|null}}
 */
function assess({
  phraseRecorded = false,
  phraseFingerprint = null,
  lastSnapshotAt = null,
  destination = null,
  now = Date.now(),
  staleAfterDays = STALE_AFTER_DAYS,
} = {}) {
  const degraded = [];
  const report = [];
  const add = (label, pass, note = '') => report.push({ label, pass, note });

  // ── Is there anywhere to put one? ───────────────────────────────────────
  const haveDestination = !!(destination && destination.ok && destination.path);
  add('backup destination', haveDestination,
    haveDestination ? destination.path : (destination?.reason || 'not chosen'));
  if (!haveDestination) {
    degraded.push({
      id: 'matsya-no-destination',
      detail: `Nowhere to keep backups. ${destination?.reason || 'No drive was readable.'}`,
      remedy: 'Free space on a drive, or point Rāma at an external disk or network folder.',
    });
  }

  // ── Is there a key? This is the one thing Rāma cannot do alone. ─────────
  add('recovery phrase', phraseRecorded,
    phraseRecorded ? (phraseFingerprint || 'recorded') : 'not generated yet');
  if (!phraseRecorded) {
    degraded.push({
      id: 'matsya-no-phrase',
      detail: 'No backups can be made yet: a backup is encrypted with a recovery phrase, and none '
        + 'has been written down. Without it a snapshot could not be opened on a replacement machine, '
        + 'which is the only situation it exists for.',
      /*
       * ONE LINE, ONE ACTION — and it names something that EXISTS TODAY.
       *
       * The first draft of this said "Open System → Backup and press Generate", which is where this
       * is going and is not there yet. A remedy that points at a button nobody can find is the same
       * defect as a report that overstates what was done, and this project has paid for that six
       * times. `verifyMatsyaReadiness` asserts that every remedy naming an `npm run` script names
       * one `package.json` actually defines, so this line cannot outrun the feature again.
       */
      remedy: 'Run: npm run matsya:phrase new — it takes a minute and is shown once.',
    });
  }

  // ── Has one ever actually happened? ────────────────────────────────────
  const stamp = lastSnapshotAt ? Date.parse(lastSnapshotAt) : NaN;
  const haveSnapshot = Number.isFinite(stamp);
  const ageDays = haveSnapshot ? Math.floor((now - stamp) / DAY_MS) : null;

  add('last backup', haveSnapshot, haveSnapshot ? `${ageDays} day(s) ago` : 'never');

  if (!haveSnapshot) {
    // Only worth saying once the things it depends on are in place; otherwise it repeats the entry
    // above in different words, and three entries for one problem reads as three problems.
    if (phraseRecorded && haveDestination) {
      degraded.push({
        id: 'matsya-never-run',
        detail: 'Everything is ready and no backup has been taken yet.',
        remedy: 'Rāma will take one automatically; nothing to do.',
      });
    }
  } else if (ageDays > staleAfterDays) {
    degraded.push({
      id: 'matsya-stale',
      detail: `The last backup was ${ageDays} days ago.`,
      remedy: ageDays > staleAfterDays * 4
        ? 'The schedule does not appear to be running; the startup health panel shows what failed.'
        : 'Rāma will take one automatically; nothing to do.',
    });
  }

  // READY MEANS READY, not "nearly". Everything must be true: somewhere to write, a key to write
  // with, and a snapshot that actually exists and is recent.
  const ready = haveDestination && phraseRecorded && haveSnapshot && ageDays <= staleAfterDays;

  return { ready, degraded, report, ageDays };
}

/**
 * One line for anywhere that has room for one line.
 *
 * Says what is true rather than a status word: "protected" would be a claim about the future, and the
 * honest version is what exists and when.
 */
function summary(result, destination) {
  if (!result) return 'Backup state unknown.';
  if (result.ready) {
    const where = destination?.path ? ` in ${destination.path}` : '';
    const caveat = destination?.sameVolume ? ', on the same disk as the original' : '';
    return `Last backup ${result.ageDays === 0 ? 'today' : `${result.ageDays} day(s) ago`}${where}${caveat}.`;
  }
  const first = result.degraded[0];
  return first ? first.detail : 'No backup has been taken.';
}

module.exports = { assess, summary, STALE_AFTER_DAYS };
