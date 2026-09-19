#!/usr/bin/env node
'use strict';

/**
 * verifyModelRoles.cjs — what Rāma needs a model FOR (Section 112).
 *
 * The behaviour worth defending is refusal and labelling: an unfit model must be EXCLUDED rather than
 * ranked lower, a sensitive role must refuse a cloud model outright, an unverified claim must produce
 * a `substitute` and never a `declared` fit, and an unfilled role must report the absence rather than
 * quietly handing the work to whatever is available — which is the old FALLBACK_CHAIN behaviour.
 *
 * Run: node scripts/verifyModelRoles.cjs   (or npm run verify:roles)
 */

const R = require('../electron/lib/modelRoles.cjs');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};

const GB = 1024 ** 3;
const model = (over = {}) => ({
  id: 'qwen3.5:9b', private: true, costTier: 0, ctxK: 128, ctxVerified: false,
  caps: ['general', 'offline'], sizeBytes: 5.4 * GB, paramsB: 9, retirement: null, ...over,
});

console.log('\nmodel roles — a role is a requirement, not a preference\n');

// ─── the declared table ───────────────────────────────────────────────────────
console.log('  the roles are declared, not inferred');
check('every role has a label and a reason master can read',
  R.ROLE_IDS.every(id => R.ROLES[id].label && R.ROLES[id].why));
check('the roles master asked for are all present',
  ['extraction', 'tool-calling', 'code', 'multilingual', 'embedding'].every(id => R.ROLE_IDS.includes(id)),
  R.ROLE_IDS.join(','));
check('the table is frozen — a role is not editable at runtime', Object.isFrozen(R.ROLES));
check('narration is the sensitive role, because it names real holdings', R.ROLES.narration.sensitive === true);
check('extraction is not sensitive — it reads text, not positions', R.ROLES.extraction.sensitive === false);
check('a requirement can be stated in words', /7B/.test(R.describeRequirement(R.ROLES['tool-calling'])));
check('an undeclared role is refused, not defaulted',
  R.evaluate('telepathy', model()).fit === 'none');
check('and __proto__ is not a role', R.evaluate('__proto__', model()).fit === 'none');
check('selecting for an undeclared role names the problem',
  /not a declared role/.test(R.selectForRole('telepathy', [model()]).why));

// ─── hard requirements exclude ────────────────────────────────────────────────
console.log('\n  a failed requirement excludes, it does not rank lower');
check('a 3B model is excluded from tool calling',
  R.evaluate('tool-calling', model({ paramsB: 3 })).fit === 'none');
check('and the reason names the published floor',
  /7B floor/.test(R.evaluate('tool-calling', model({ paramsB: 3 })).reasons.join()),
  R.evaluate('tool-calling', model({ paramsB: 3 })).reasons.join());
check('a 9B model clears tool calling', R.evaluate('tool-calling', model()).fit !== 'none');
check('a model not reporting "code" is excluded from the code role',
  R.evaluate('code', model()).fit === 'none');
check('and is fit once it reports it',
  R.evaluate('code', model({ caps: ['code', 'offline'] })).fit !== 'none');
check('a 9B model is excluded from reasoning at a 14B floor',
  R.evaluate('reasoning', model()).fit === 'none');
check('a retired model is never a candidate, whatever else it satisfies',
  R.evaluate('extraction', model({ retirement: { retired: true, replacement: 'qwen3.5:27b' } })).fit === 'none');
check('and the replacement is named in the reason',
  /qwen3.5:27b/.test(R.evaluate('extraction', model({ retirement: { retired: true, replacement: 'qwen3.5:27b' } })).reasons.join()));
check('a 32K window is excluded from long context',
  R.evaluate('long-context', model({ ctxK: 32 })).fit === 'none');
check('an unknown window is excluded rather than assumed',
  R.evaluate('long-context', model({ ctxK: null })).fit === 'none');

// ─── the embedding split, both directions ─────────────────────────────────────
console.log('\n  embedding and chat are not interchangeable');
const embed = model({ id: 'nomic-embed-text:latest', paramsB: 0.14, caps: ['offline'] });
check('an embedding model is recognised', R.isEmbeddingModel(embed) === true);
check('a chat model is not', R.isEmbeddingModel(model()) === false);
check('a chat model cannot fill the embedding role', R.evaluate('embedding', model()).fit === 'none');
check('and the reason says why', /cannot produce vectors/.test(R.evaluate('embedding', model()).reasons.join()));
check('an embedding model fills it', R.evaluate('embedding', embed).fit !== 'none');
check('an embedding model cannot fill a chat role', R.evaluate('extraction', embed).fit === 'none');
check('and that reason is the mirror image',
  /cannot generate text/.test(R.evaluate('extraction', embed).reasons.join()));
check('mxbai is recognised by family', R.isEmbeddingModel({ id: 'mxbai-embed-large:latest' }) === true);
check('all-minilm is recognised', R.isEmbeddingModel({ id: 'all-minilm:33m' }) === true);

// ─── sensitivity is a gate, not a ranking ─────────────────────────────────────
console.log('\n  a prompt that has left this machine cannot be recalled');
const cloud = model({ id: 'qwen3.5:397b-cloud', private: false, costTier: 1, paramsB: 397, sizeBytes: null, caps: ['general'] });
check('a cloud model is refused the narration role outright',
  R.evaluate('narration', cloud).fit === 'none');
check('and the reason is privacy, not size',
  /not private/.test(R.evaluate('narration', cloud).reasons.join()));
check('a 397B cloud model does not win narration by being large',
  R.selectForRole('narration', [cloud, model()]).model === 'qwen3.5:9b');
check('the cloud model appears in excluded, so the choice is auditable',
  R.selectForRole('narration', [cloud, model()]).excluded.some(e => /397b/.test(e.id)));
check('a caller can raise sensitivity on a role that is not sensitive by default',
  R.evaluate('extraction', cloud, { requirePrivate: true }).fit === 'none');
check('and extraction accepts a cloud model when it is not raised',
  R.evaluate('extraction', cloud).fit !== 'none');

// ─── unverified means substitute, never fit ───────────────────────────────────
console.log('\n  an unverified claim is a substitute, never a declared fit');
const lc = R.evaluate('long-context', model({ ctxK: 128, ctxVerified: false }));
check('a claimed context window carries the role only as a substitute', lc.fit === 'substitute', lc.fit);
check('and says the window was never measured here',
  /never measured/.test(lc.unverified.join()), lc.unverified.join());
check('a verified window is a declared fit',
  R.evaluate('long-context', model({ ctxK: 128, ctxVerified: true })).fit === 'declared');
const ml = R.evaluate('multilingual', model());
check('multilingual is a substitute by construction — Rāma has no local test', ml.fit === 'substitute');
check('and that is stated rather than implied',
  /no local measurement/.test(ml.unverified.join()), ml.unverified.join());
const unknownP = R.evaluate('tool-calling', model({ paramsB: null }));
check('an unknown parameter count does not silently pass the floor', unknownP.fit === 'substitute');
check('and reports the floor as unchecked', /unchecked/.test(unknownP.unverified.join()));

// ─── disk is the binding constraint ───────────────────────────────────────────
console.log('\n  disk is master\'s binding constraint');
const big = model({ id: 'qwen3.5:27b', paramsB: 27, sizeBytes: 17 * GB });
check('a model over the disk budget is excluded',
  R.evaluate('extraction', big, { diskBudgetBytes: 8 * GB }).fit === 'none');
check('and the reason carries both numbers',
  /17.0GB.*8.0GB/.test(R.evaluate('extraction', big, { diskBudgetBytes: 8 * GB }).reasons.join()),
  R.evaluate('extraction', big, { diskBudgetBytes: 8 * GB }).reasons.join());
check('a cloud model is not charged disk it does not use',
  R.evaluate('extraction', cloud, { diskBudgetBytes: 1 * GB }).fit !== 'none');
check('reported size is preferred over the size implied by parameters',
  R.residentBytes(model({ sizeBytes: 5 * GB, paramsB: 70 })) === 5 * GB);
check('and the parameter count is the fallback when size is unknown',
  R.residentBytes({ paramsB: 9, sizeBytes: null }) > 0);
// Found by running: Number(null) is 0, so "unknown" was read as "zero" — and zero clears or fails a
// threshold confidently.
check('unknown is not zero', R.num(null) === null && R.num(undefined) === null && R.num('') === null);
check('zero is still zero', R.num(0) === 0);
check('a numeric string is a number', R.num('9') === 9);
check('a non-numeric string is unknown, not NaN', R.num('nine') === null);
check('an unknown size does not report as zero bytes',
  R.residentBytes({ paramsB: null, sizeBytes: null }) === null);
check('an unknown size does not silently pass the budget',
  R.evaluate('extraction', model({ sizeBytes: null, paramsB: null }), { diskBudgetBytes: 1 * GB }).fit === 'substitute');

// ─── ranking ──────────────────────────────────────────────────────────────────
console.log('\n  cheapest sufficient, not best available');
const small = model({ id: 'qwen3.5:9b', paramsB: 9 });
const large = model({ id: 'qwen3.5:27b', paramsB: 27, sizeBytes: 17 * GB });
check('for a role with a floor, the smallest model that clears it wins',
  R.selectForRole('tool-calling', [large, small]).model === 'qwen3.5:9b');
check('a declared fit beats a substitute even when the substitute is larger',
  R.selectForRole('long-context', [
    model({ id: 'a:9b', ctxK: 128, ctxVerified: false }),
    model({ id: 'b:7b', paramsB: 7, ctxK: 128, ctxVerified: true }),
  ]).model === 'b:7b');
check('a local model beats a cloud model of equal fitness',
  R.selectForRole('extraction', [cloud, small]).model === 'qwen3.5:9b');
check('the cheaper of two cloud models wins',
  R.selectForRole('extraction', [
    model({ id: 'x:9b', private: false, costTier: 3 }),
    model({ id: 'y:9b', private: false, costTier: 1 }),
  ]).model === 'y:9b');
check('every candidate considered is reported, not just the winner',
  R.selectForRole('extraction', [small, large]).candidates.length === 2);

// ─── an unfilled role reports the absence ─────────────────────────────────────
console.log('\n  an unfilled role is an absence, not a substitution');
const none = R.selectForRole('vision', [small, large]);
check('no fit means no model', none.model === null);
check('and the fit is none, not a silent default', none.fit === 'none');
check('and it says how many were checked and failed', /2 models checked/.test(none.why), none.why);
check('the exclusions carry a reason each', none.excluded.every(e => e.why.length > 0));
const nothing = R.selectForRole('vision', []);
check('nothing discovered reads differently from nothing fit',
  /no models are available at all/.test(nothing.why), nothing.why);
check('an empty list does not throw', nothing.model === null);
check('a null list does not throw',
  (() => { try { return R.selectForRole('vision', null).model === null; } catch { return false; } })());
check('a model with no id is excluded rather than crashing',
  R.evaluate('extraction', { paramsB: 9 }).fit === 'none');
check('no model at all is refused', R.evaluate('extraction', null).fit === 'none');

// ─── the whole table ──────────────────────────────────────────────────────────
console.log('\n  one table rather than nine questions');
const p = R.plan([small, large, embed, cloud], { diskBudgetBytes: 64 * GB });
check('every role gets a row', p.rows.length === R.ROLE_IDS.length);
check('filled, substituted and unfilled are counted separately',
  Number.isInteger(p.filled) && Number.isInteger(p.substituted) && Array.isArray(p.unfilled));
check('vision is unfilled, because nothing here reports it', p.unfilled.includes('vision'));
check('embedding is filled by the embedding model',
  p.rows.find(r => r.role === 'embedding').model === 'nomic-embed-text:latest');
check('narration is filled by a private model or not at all',
  p.rows.find(r => r.role === 'narration').model === null
  || p.rows.find(r => r.role === 'narration').private === true);
check('the discovered count distinguishes "nothing fits" from "nothing found"', p.discovered === 4);
check('an empty plan still returns every row', R.plan([]).rows.length === R.ROLE_IDS.length);
check('and every row is unfilled rather than defaulted',
  R.plan([]).rows.every(r => r.model === null));
check('no row carries a confidence score',
  !/confidence|probability|score/i.test(JSON.stringify(p)));

// ─── research: from the catalogue, never from memory ──────────────────────────
console.log('\n  research recommends from the fetched catalogue, never from memory');
const noCat = R.researchPlan([small], { catalogData: null });
check('with no catalogue, nothing is recommended', noCat.recommendations.length === 0);
check('and that is reported as blocked, not as "nothing needed"',
  /has not been fetched/.test(noCat.blocked || ''), String(noCat.blocked));
check('the gaps are still named without a catalogue', noCat.gaps.length > 0);
const withCat = R.researchPlan([small], {
  catalogData: { qwen3: { name: 'qwen3', description: 'general', sizes: ['7b', '14b'] } },
  schedule: [], diskBudgetBytes: 64 * GB,
});
check('with a catalogue, blocked is null', withCat.blocked === null);
check('each gap carries the requirement in words',
  withCat.recommendations.every(r => typeof r.requirement === 'string' && r.requirement.length > 0));
check('a gap the catalogue cannot fill says so rather than returning an empty list',
  withCat.recommendations.every(r => r.candidates.length > 0 || typeof r.note === 'string'));
check('a broken catalogue does not throw',
  (() => { try { R.researchPlan([small], { catalogData: { x: null } }); return true; } catch { return false; } })());

// ─── purity ───────────────────────────────────────────────────────────────────
console.log('\n  purity');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'lib', 'modelRoles.cjs'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
check('it requires no Electron', !/require\(['"]electron['"]\)/.test(code));
check('it persists nothing', !/writeFile|dataStore/.test(code));
check('it makes no capability decision — fitness is not authorisation',
  !/capability|\.can\(/i.test(code));
check('it reaches no network — selection is over what was already discovered',
  !/http|request\(|fetch\(/i.test(code));
const input = [small];
const before = JSON.stringify(input);
R.plan(input, { diskBudgetBytes: 8 * GB });
check('the caller\'s model list is not mutated', JSON.stringify(input) === before);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
