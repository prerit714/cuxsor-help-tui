// Registers (or removes) this MCP server in every detected MCP client.
// Supported clients: Claude Code (via its `claude mcp` CLI, plus the skills/image-bridge skill that
// makes "img__" ids auto-trigger get_image) and Cursor (mcp.json).
//
//   node scripts/setup-clients.mjs [--only claude,cursor] [--scope user|project]
//                                  [--name image-bridge] [--url http://127.0.0.1:3333/mcp]
//                                  [--cursor-home <dir containing .cursor/>] [--remove] [--dry-run]
// Under WSL, Cursor's config is written to the Windows profile (Cursor runs on Windows).
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fail, hasCommand, isWsl, run, windowsHome } from './lib.mjs';

const { values: opts } = parseArgs({
  options: {
    only: { type: 'string' },
    scope: { type: 'string', default: 'user' },
    name: { type: 'string', default: 'image-bridge' },
    url: { type: 'string' },
    'cursor-home': { type: 'string' },
    remove: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opts.help) {
  const header = readFileSync(new URL(import.meta.url), 'utf8').split(/\r?\n/);
  console.log(header.slice(0, header.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT || '3333';
const url = opts.url ?? `http://${host.includes(':') ? `[${host}]` : host}:${port}/mcp`;
const dryRun = opts['dry-run'];
const wsl = isWsl();

// Values end up as CLI args (possibly through cmd.exe on Windows), so keep them shell-safe.
if (!/^[A-Za-z0-9_-]+$/.test(opts.name)) fail(`--name must match [A-Za-z0-9_-]+ (got "${opts.name}")`);
if (!/^https?:\/\/[A-Za-z0-9.\-:[\]]+(\/[A-Za-z0-9._~\/-]*)?$/.test(url)) fail(`invalid --url "${url}"`);
if (!['user', 'project'].includes(opts.scope)) fail('--scope must be "user" or "project"');

/**
 * Each client: detect() → is it installed; apply()/remove() → returns a one-line summary.
 * In dry-run mode they describe what they would do instead of doing it.
 */
const SKILL_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'image-bridge');

const clients = {
  claude: {
    label: 'Claude Code',
    detect: () => hasCommand('claude'),
    // Skills live in <config dir>/skills/<name>/SKILL.md (user) or ./.claude/skills/<name>/ (project).
    skillDir: () =>
      opts.scope === 'user'
        ? path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills', 'image-bridge')
        : path.join(process.cwd(), '.claude', 'skills', 'image-bridge'),
    apply() {
      const scope = opts.scope; // claude scopes: user (~/.claude.json) | project (./.mcp.json)
      const add = ['mcp', 'add', '--scope', scope, '--transport', 'http', opts.name, url];
      const skill = this.skillDir();
      if (dryRun) {
        return `would run: claude mcp remove ${opts.name} --scope ${scope}; claude ${add.join(' ')}\n   and copy ${SKILL_SRC} → ${skill}`;
      }
      // Re-adding is how we make this idempotent: `mcp add` refuses an existing name.
      run('claude', ['mcp', 'remove', opts.name, '--scope', scope]);
      expectOk(run('claude', add), 'claude mcp add');
      cpSync(SKILL_SRC, skill, { recursive: true });
      return `added "${opts.name}" (${scope} scope) → ${url}; skill installed at ${skill}`;
    },
    remove() {
      const args = ['mcp', 'remove', opts.name, '--scope', opts.scope];
      const skill = this.skillDir();
      if (dryRun) return `would run: claude ${args.join(' ')}; and delete ${skill}`;
      const r = run('claude', args);
      const hadSkill = existsSync(skill);
      if (hadSkill) rmSync(skill, { recursive: true, force: true });
      const mcp = r.status === 0 ? `removed "${opts.name}" (${opts.scope} scope)` : `"${opts.name}" was not configured`;
      return `${mcp}; skill ${hadSkill ? 'removed' : 'was not installed'}`;
    },
  },

  cursor: {
    label: 'Cursor',
    configPath: () =>
      opts.scope === 'user'
        ? path.join(cursorHome(), '.cursor', 'mcp.json')
        : path.join(process.cwd(), '.cursor', 'mcp.json'),
    // In WSL, `cursor` on PATH is the Windows app's interop shim, so it says nothing about a Linux install.
    detect: () => existsSync(path.join(cursorHome(), '.cursor')) || (!wsl && hasCommand('cursor')),
    apply() {
      return editJson(this.configPath(), (cfg) => {
        cfg.mcpServers ??= {};
        cfg.mcpServers[opts.name] = { url };
      });
    },
    remove() {
      return editJson(this.configPath(), (cfg) => {
        if (!cfg.mcpServers?.[opts.name]) return false;
        delete cfg.mcpServers[opts.name];
      });
    },
  },
};

let cachedCursorHome;
/**
 * Home directory whose .cursor/ holds Cursor's global config. Under WSL, Cursor is a Windows app
 * (it reaches WSL via Remote-WSL), so that's the Windows profile rather than the Linux $HOME.
 */
function cursorHome() {
  if (cachedCursorHome) return cachedCursorHome;
  if (opts['cursor-home']) return (cachedCursorHome = path.resolve(opts['cursor-home']));
  if (!wsl) return (cachedCursorHome = os.homedir());
  let win = windowsHome();
  if (!win) {
    // Interop can be broken (e.g. systemd distros dropping the WSLInterop binfmt entry), so fall back
    // to the single Windows profile that has a .cursor folder.
    const users = '/mnt/c/Users';
    const found = existsSync(users)
      ? readdirSync(users).map((u) => path.join(users, u)).filter((d) => existsSync(path.join(d, '.cursor')))
      : [];
    if (found.length === 1) win = found[0];
    else console.log('! WSL: could not locate the Windows profile; using Linux $HOME for Cursor (override with --cursor-home)');
  }
  return (cachedCursorHome = win ?? os.homedir());
}

function expectOk(r, what) {
  if (r.error || r.status !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim()}`);
}

/**
 * Read-modify-write a JSON config, preserving every other entry. `mutate` returning false means "no change".
 * Refuses to touch files it can't parse (e.g. hand-written JSONC) rather than clobbering them.
 */
function editJson(file, mutate) {
  let cfg = {};
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    try {
      cfg = text.trim() ? JSON.parse(text) : {};
    } catch (err) {
      throw new Error(
        `${file} is not plain JSON (${err.message}); left untouched. Add manually:\n` +
          JSON.stringify({ mcpServers: { [opts.name]: { url } } }, null, 2),
      );
    }
  }
  if (mutate(cfg) === false) return `"${opts.name}" was not configured in ${file}`;
  const out = JSON.stringify(cfg, null, 2) + '\n';
  if (dryRun) return `would write ${file}:\n${out}`;
  mkdirSync(path.dirname(file), { recursive: true });
  const hadFile = existsSync(file);
  if (hadFile) copyFileSync(file, `${file}.bak`);
  writeFileSync(file, out);
  return `${hadFile ? 'updated' : 'created'} ${file}${hadFile ? ` (previous version: ${path.basename(file)}.bak)` : ''}`;
}

// ---- main ----
const requested = opts.only ? opts.only.split(',').map((s) => s.trim().toLowerCase()) : Object.keys(clients);
const unknown = requested.filter((c) => !(c in clients));
if (unknown.length) fail(`unknown client(s): ${unknown.join(', ')} (supported: ${Object.keys(clients).join(', ')})`);

console.log(`${opts.remove ? 'Removing' : 'Registering'} MCP server "${opts.name}" → ${url}${dryRun ? ' [dry run]' : ''}\n`);

let failures = 0;
const changed = [];
for (const key of requested) {
  const client = clients[key];
  if (!client.detect()) {
    // Explicitly requested but missing is an error; auto-detected-missing is just skipped.
    if (opts.only) failures++;
    console.log(`${opts.only ? '✖' : '–'} ${client.label}: not found, skipped`);
    continue;
  }
  try {
    console.log(`✔ ${client.label}: ${opts.remove ? client.remove() : client.apply()}`);
    changed.push(key);
  } catch (err) {
    failures++;
    console.log(`✖ ${client.label}: ${err.message}`);
  }
}

if (!opts.remove && !dryRun) {
  // Non-fatal: clients can be configured before the server is started.
  const health = new URL('/healthz', url);
  const up = await fetch(health, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
  if (!up) console.log(`\nNote: server not reachable at ${health.origin} yet. Start it with: npm run dev`);
  if (!up && wsl) {
    console.log(
      '  WSL: run the server inside WSL. Windows apps reach it via localhost forwarding, but with the default\n' +
        '  NAT networking WSL cannot reach a server bound to Windows\' 127.0.0.1 (unless networkingMode=mirrored).',
    );
  }
}
if (!dryRun && changed.includes('cursor')) console.log('\nRestart Cursor (or reload its MCP settings) to pick up the change.');

process.exit(failures ? 1 : 0);
