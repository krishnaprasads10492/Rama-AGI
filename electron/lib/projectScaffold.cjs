'use strict';

/**
 * projectScaffold.cjs — create a project, and have Rāma already know about it (spec Section 86).
 *
 * Master's point: "if I create a new project using the IDE, then that should automatically be
 * available to Rāma". So creation ends with `workspaceRegistry.register({ createdByRama: true })`.
 * There is no second step where he tells Rāma what he just made — the thing that made it records it.
 *
 * ─── SAFETY, BECAUSE THIS WRITES FILES ───────────────────────────────────────
 *
 * 1. IT REFUSES TO SCAFFOLD INSIDE RĀMA'S OWN SOURCE TREE. A template dropping `package.json`,
 *    `.gitignore` or `README.md` into the repo that *is* Rāma would overwrite the real ones. The
 *    IDE is pointed at arbitrary folders by design, so this is a plausible accident with a very
 *    expensive outcome, and it is checked rather than trusted.
 * 2. It refuses a non-empty directory unless `force`, and even then never overwrites an existing
 *    file — it skips and reports. Creating a project must not be a way to lose work.
 * 3. The project name is sanitised before it reaches a path, and the resolved destination is
 *    verified to still be inside the chosen parent, so `../../` in a name cannot escape.
 * 4. `git init` and the first commit are optional and best-effort. A template that wrote its files
 *    but could not reach git is a success with a note, not a failure — the files are what matter.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const registry = require('./workspaceRegistry.cjs');

const GITIGNORE_COMMON = `node_modules/
dist/
build/
.env
*.log
.DS_Store
Thumbs.db
__pycache__/
.venv/
venv/
`;

/**
 * Templates. Deliberately small and honest: each produces something that RUNS, rather than a large
 * skeleton of placeholder files. A scaffold full of TODOs is worse than an empty folder, because it
 * looks like progress (I12: no placeholders).
 */
const TEMPLATES = {
  empty: {
    label: 'Empty folder',
    describe: 'Just a folder, a README and a .gitignore.',
    files: ({ name }) => ({
      'README.md': `# ${name}\n`,
      '.gitignore': GITIGNORE_COMMON,
    }),
  },

  'node-cli': {
    label: 'Node CLI',
    describe: 'A runnable Node script with package.json. `node index.js`.',
    files: ({ name, slug }) => ({
      'package.json': `${JSON.stringify({
        name: slug, version: '0.1.0', private: true, type: 'commonjs',
        main: 'index.js', scripts: { start: 'node index.js' },
      }, null, 2)}\n`,
      'index.js': `#!/usr/bin/env node\n'use strict';\n\n`
        + `function main(argv) {\n  const who = argv[0] || 'world';\n`
        + `  process.stdout.write(\`${name}: hello \${who}\\n\`);\n  return 0;\n}\n\n`
        + `process.exit(main(process.argv.slice(2)));\n`,
      'README.md': `# ${name}\n\n\`\`\`\nnode index.js\n\`\`\`\n`,
      '.gitignore': GITIGNORE_COMMON,
    }),
  },

  'node-lib': {
    label: 'Node library',
    describe: 'A module with an entry point and a plain assertion test.',
    files: ({ name, slug }) => ({
      'package.json': `${JSON.stringify({
        name: slug, version: '0.1.0', private: true, type: 'commonjs',
        main: 'src/index.js', scripts: { test: 'node test/index.test.js' },
      }, null, 2)}\n`,
      'src/index.js': `'use strict';\n\nfunction greet(who = 'world') {\n`
        + `  return \`hello \${who}\`;\n}\n\nmodule.exports = { greet };\n`,
      'test/index.test.js': `'use strict';\nconst assert = require('assert');\n`
        + `const { greet } = require('../src/index.js');\n\n`
        + `assert.strictEqual(greet(), 'hello world');\n`
        + `assert.strictEqual(greet('rama'), 'hello rama');\n`
        + `process.stdout.write('ok\\n');\n`,
      'README.md': `# ${name}\n\n\`\`\`\nnpm test\n\`\`\`\n`,
      '.gitignore': GITIGNORE_COMMON,
    }),
  },

  python: {
    label: 'Python',
    describe: 'A package with a runnable module and requirements.txt.',
    files: ({ name, slug }) => ({
      'requirements.txt': '',
      [`${slug.replace(/-/g, '_')}/__init__.py`]: '',
      [`${slug.replace(/-/g, '_')}/main.py`]: `def greet(who: str = "world") -> str:\n`
        + `    return f"hello {who}"\n\n\n`
        + `if __name__ == "__main__":\n    print(greet())\n`,
      'README.md': `# ${name}\n\n\`\`\`\npython -m ${slug.replace(/-/g, '_')}.main\n\`\`\`\n`,
      '.gitignore': GITIGNORE_COMMON,
    }),
  },

  static: {
    label: 'Static site',
    describe: 'One HTML page with its own stylesheet. Opens in a browser directly.',
    files: ({ name }) => ({
      'index.html': `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n`
        + `<meta name="viewport" content="width=device-width,initial-scale=1">\n`
        + `<title>${name}</title>\n<link rel="stylesheet" href="style.css">\n</head>\n`
        + `<body>\n  <main>\n    <h1>${name}</h1>\n    <p>Edit index.html to begin.</p>\n`
        + `  </main>\n</body>\n</html>\n`,
      'style.css': `:root { color-scheme: dark; }\nbody {\n`
        + `  margin: 0; min-height: 100vh; display: grid; place-items: center;\n`
        + `  font-family: system-ui, sans-serif; background: #0b0f17; color: #e8f4ff;\n}\n`,
      'README.md': `# ${name}\n\nOpen \`index.html\`.\n`,
      '.gitignore': GITIGNORE_COMMON,
    }),
  },
};

function templateList() {
  return Object.entries(TEMPLATES).map(([id, t]) => ({
    id, label: t.label, describe: t.describe,
  }));
}

/** A filesystem-safe folder name. Anything that could traverse is stripped, not escaped. */
function slugify(name) {
  return String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64)
    .toLowerCase();
}

/**
 * Is `child` inside `parent`? Used both to keep a project inside its chosen parent and to keep
 * scaffolding out of Rāma's own tree.
 */
function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Rāma's own source root — the one place a template must never write. */
function ramaRoot() {
  return path.resolve(__dirname, '..', '..');
}

function create({ parentDir, name, template = 'empty', git = true, force = false,
  onLog = () => {} } = {}) {
  if (!parentDir) return { ok: false, error: 'a parent directory is required' };
  if (!name || !String(name).trim()) return { ok: false, error: 'a project name is required' };

  const tpl = TEMPLATES[template];
  if (!tpl) {
    return { ok: false, error: `unknown template ${template}`, templates: Object.keys(TEMPLATES) };
  }

  const slug = slugify(name);
  if (!slug) {
    return { ok: false, error: `"${name}" has no characters usable in a folder name` };
  }

  const parent = path.resolve(String(parentDir).trim());
  const dest = path.resolve(parent, slug);

  // A name like `../../evil` cannot climb out, because the resolved destination must still be
  // inside the parent master chose.
  if (!isInside(parent, dest) || dest === parent) {
    return { ok: false, error: 'the resolved project path escaped the chosen parent directory' };
  }

  // THE GUARD THAT MATTERS: never scaffold into Rāma's own source. A template writing
  // package.json / .gitignore / README.md here would overwrite the real ones.
  const root = ramaRoot();
  if (isInside(root, dest)) {
    return {
      ok: false,
      error: 'refusing to create a project inside Rāma\'s own source tree — a template would '
        + `overwrite Rāma's package.json, .gitignore or README. Choose a folder outside ${root}.`,
    };
  }

  if (!fs.existsSync(parent)) {
    return { ok: false, error: `the parent directory does not exist: ${parent}` };
  }

  let existing = [];
  if (fs.existsSync(dest)) {
    try {
      existing = fs.readdirSync(dest);
    } catch (err) {
      return { ok: false, error: `${dest} exists but cannot be read: ${err.message}` };
    }
    if (existing.length > 0 && !force) {
      return {
        ok: false,
        error: `${dest} already exists and is not empty (${existing.length} entries). `
          + 'Choose another name, or force it — existing files are never overwritten either way.',
        exists: true,
      };
    }
  }

  const files = tpl.files({ name: String(name).trim(), slug });
  const written = [];
  const skipped = [];

  try {
    fs.mkdirSync(dest, { recursive: true });
    for (const [rel, body] of Object.entries(files)) {
      const target = path.resolve(dest, rel);
      // Belt and braces: a template key can never write outside the project either.
      if (!isInside(dest, target)) {
        skipped.push({ file: rel, why: 'outside the project directory' });
        continue;
      }
      if (fs.existsSync(target)) {
        skipped.push({ file: rel, why: 'already exists — left untouched' });
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body, 'utf8');
      written.push(rel);
      onLog(`  + ${rel}\n`);
    }
  } catch (err) {
    return { ok: false, error: `could not write the project: ${err.message}`, written, skipped };
  }

  // Best-effort git. The files are the deliverable; a missing git binary is a note, not a failure.
  let gitResult = null;
  if (git) {
    try {
      const run = (args) => spawnSync('git', args, { cwd: dest, encoding: 'utf8' });
      const init = run(['init']);
      if (init.status === 0) {
        run(['add', '.']);
        const commit = run(['commit', '-m', `chore: scaffold ${slug} from Rāma`]);
        gitResult = commit.status === 0
          ? { initialised: true, committed: true }
          : {
            initialised: true,
            committed: false,
            note: 'git init worked but the first commit did not — usually user.name/user.email '
              + 'are not configured. The repository is there; commit when ready.',
          };
      } else {
        gitResult = { initialised: false, note: 'git init failed — is git on PATH?' };
      }
    } catch (err) {
      gitResult = { initialised: false, note: `git unavailable: ${err.message}` };
    }
    onLog(gitResult.committed ? '  git: initialised and committed\n'
      : `  git: ${gitResult.note}\n`);
  }

  // THE POINT OF THE WHOLE FEATURE: Rāma now knows about this project without being told again.
  const reg = registry.register({
    path: dest,
    name: String(name).trim(),
    createdByRama: true,
    pinned: true,          // something master just made is what he is about to work on
  });

  return {
    ok: true,
    path: dest,
    name: String(name).trim(),
    slug,
    template,
    written,
    skipped,
    git: gitResult,
    registered: reg.ok,
    project: reg.project || null,
  };
}

module.exports = { create, templateList, slugify, isInside, ramaRoot, TEMPLATES };
