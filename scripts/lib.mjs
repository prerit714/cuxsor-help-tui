// Shared helpers for the Node-based setup scripts (no bash/PowerShell dependency).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const AZURITE_IMAGE = 'mcr.microsoft.com/azure-storage/azurite';
export const AZURITE_NAME = 'cuxsor-azurite';
export const AZURITE_VOLUME = 'cuxsor-azurite-data';

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false, ...opts });
  // On Windows, npm-style .cmd shims can't be spawned directly; retry through cmd.exe.
  // Callers only pass shell-safe args (no spaces/metacharacters), so no extra quoting is needed.
  if (process.platform === 'win32' && ['ENOENT', 'EINVAL'].includes(r.error?.code)) {
    return spawnSync(cmd, args, { encoding: 'utf8', ...opts, shell: true });
  }
  return r;
}

/** True when `cmd --version` runs successfully. */
export function hasCommand(cmd) {
  const r = run(cmd, ['--version']);
  return !r.error && r.status === 0;
}

/** True inside WSL (1 or 2), where Windows apps and their configs live under /mnt/<drive>. */
export function isWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  // A "microsoft" kernel alone isn't enough: Docker Desktop containers share the WSL kernel.
  // /run/WSL only exists inside actual WSL distros.
  try {
    return /microsoft/i.test(readFileSync('/proc/sys/kernel/osrelease', 'utf8')) && existsSync('/run/WSL');
  } catch {
    return false;
  }
}

/** Windows %USERPROFILE% as a WSL path (e.g. /mnt/c/Users/me), or null if interop is unavailable. */
export function windowsHome() {
  // cmd.exe warns about UNC paths when started from the Linux filesystem, so run it from a Windows drive.
  const cwd = existsSync('/mnt/c') ? '/mnt/c' : undefined;
  for (const cmd of ['cmd.exe', '/mnt/c/Windows/System32/cmd.exe']) {
    const r = run(cmd, ['/d', '/c', 'echo %USERPROFILE%'], { cwd });
    const win = r.status === 0 ? r.stdout.trim() : '';
    if (!win || win.includes('%')) continue;
    const p = run('wslpath', ['-u', win]);
    if (p.status === 0 && p.stdout.trim()) return p.stdout.trim();
  }
  return null;
}

/** Returns 'docker' | 'podman' | null. $CONTAINER_RUNTIME wins when set. */
export function detectRuntime() {
  const forced = process.env.CONTAINER_RUNTIME?.trim();
  if (forced) return hasCommand(forced) ? forced : null;
  for (const c of ['docker', 'podman']) if (hasCommand(c)) return c;
  return null;
}

export function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}
