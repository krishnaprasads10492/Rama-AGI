/**
 * engineSetupModel.js - what the "Set up the engine" panel says, as data (spec Section 154)
 *
 * The panel appears when StockMind cannot run, which is exactly when a vague sentence costs most. So every
 * sentence is made here from the main process's answer and driven by `scripts/verifyEngineSetup.mjs`:
 *   - say WHICH Python was found and why it does or does not qualify (3.10 to 3.12 only)
 *   - never offer to install Python unless the main process said it can
 *   - never claim ready unless the packages import in the engine environment
 *   - a failed setup shows the stage that failed and the last lines of output
 */

export const STAGES = {
  find: 'Looking for Python',
  python: 'Installing Python',
  venv: 'Creating the engine environment',
  pip: 'Updating pip',
  install: 'Installing the engine packages',
  verify: 'Checking the packages import',
  done: 'Done',
};

export const stageLabel = (s) => STAGES[s] || 'Working';

/** The headline state: one of ready | running | failed | needs-python | needs-setup | unknown. */
export function stateOf(st) {
  if (!st) return 'unknown';
  if (st.setup && st.setup.running) return 'running';
  if (st.ready) return 'ready';
  if (st.setup && st.setup.result && st.setup.result.ok === false) return 'failed';
  if (st.python && st.python.ok === false) return 'needs-python';
  return 'needs-setup';
}

export function headline(st) {
  switch (stateOf(st)) {
    case 'ready': return 'The engine environment is ready.';
    case 'running': return `${stageLabel(st.setup.stage)} ...`;
    case 'failed': return `Setup stopped at "${stageLabel(st.setup.result.stage)}".`;
    case 'needs-python': return 'The engine needs Python 3.10 to 3.12, and this machine does not have one.';
    case 'needs-setup': return `Python ${st.python && st.python.version} is available. The engine environment has not been built yet.`;
    default: return 'The engine setup state is not known yet.';
  }
}

/** Detail lines under the headline. Strings only. */
export function details(st) {
  const out = [];
  if (!st) return out;
  const state = stateOf(st);
  if (state === 'needs-python' && st.python) {
    out.push(st.python.reason || 'No supported Python was found.');
    out.push('The engine\'s pinned packages publish no wheels for newer Python versions, so Python 3.13 or later cannot run it.');
  }
  if (state === 'needs-setup' && st.python && st.python.label) out.push(`Found by: ${st.python.label}.`);
  if (state === 'failed' && st.setup.result.error) out.push(st.setup.result.error);
  if (st.venvExists && !st.depsOk && state !== 'running') out.push('An environment exists, but a package fails to import. Setup will repair it.');
  if (state === 'ready' && st.venvDir) out.push(`Environment: ${st.venvDir}`);
  if (st.pythonInstallNote && state === 'needs-python') out.push(st.pythonInstallNote);
  return out;
}

/** Which buttons to show. `canConfig` is courtesy; the main process refuses a caller without stockmind.config. */
export function actions(st, canConfig) {
  const state = stateOf(st);
  const none = { setup: false, installPython: false, refresh: true };
  if (!st || !canConfig) return { ...none, why: !canConfig ? 'Your account can see the engine state but not change it.' : null };
  if (state === 'running') return { ...none, why: 'A setup is running.' };
  if (state === 'ready') return { ...none, setup: false, why: null };
  if (state === 'needs-python') return { ...none, installPython: !!st.canInstallPython, why: null };
  return { ...none, setup: true, why: null };
}

/** The last output lines, newest last, for a running or failed setup. */
export function outputLines(st) {
  const lines = st && st.setup && Array.isArray(st.setup.lines) ? st.setup.lines : [];
  return lines.slice(-12);
}

/** Should the panel keep asking for status? Only while something is running. */
export function shouldPoll(st) {
  return !!(st && st.setup && st.setup.running);
}
