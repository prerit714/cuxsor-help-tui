// Verifies required tooling exists before dev/start. Exits non-zero with a clear message.
import { detectRuntime, fail, isWsl, run } from './lib.mjs';

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) fail(`Node >= 22 required, found ${process.version}`);
console.log(`✔ node ${process.version}`);

const rt = detectRuntime();
if (!rt) {
  if (process.env.CONTAINER_RUNTIME) fail(`CONTAINER_RUNTIME=${process.env.CONTAINER_RUNTIME} is not runnable`);
  // Docker Desktop puts a placeholder `docker` into WSL distros that don't have integration enabled.
  const stub = isWsl() && /WSL integration|could not be found in this WSL/i.test(run('docker', ['--version']).stdout ?? '');
  fail(
    stub
      ? 'docker in this WSL distro is Docker Desktop\'s placeholder. Enable it under Docker Desktop → Settings → Resources → WSL integration, or install podman in the distro'
      : 'Neither docker nor podman found on PATH (needed for Azurite)',
  );
}

const info = run(rt, ['info']);
if (info.status !== 0) {
  const detail = (info.stderr || '').trim().split('\n').find(Boolean) ?? '';
  const hint = /permission denied/i.test(detail)
    ? `add your user to the "${rt}" group (then log out and back in), or use rootless podman`
    : 'is the daemon / podman machine running?';
  fail(`${rt} is installed but not usable: ${detail || 'no details'}\n  → ${hint}`);
}
console.log(`✔ ${rt} available`);
