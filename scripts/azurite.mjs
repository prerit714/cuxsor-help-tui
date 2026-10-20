// Manage the Azurite (blob-only) container: up | down | status | nuke
import { AZURITE_IMAGE, AZURITE_NAME, AZURITE_VOLUME, detectRuntime, fail, run } from './lib.mjs';

const USAGE = 'usage: node scripts/azurite.mjs <up|down|status|nuke>';
const cmd = process.argv[2];
if (!['up', 'down', 'status', 'nuke'].includes(cmd)) fail(USAGE);
const rt = detectRuntime() ?? fail('Neither docker nor podman found on PATH');
const port = process.env.AZURITE_PORT || '10000';

function state() {
  const r = run(rt, ['inspect', '-f', '{{.State.Running}}', AZURITE_NAME]);
  if (r.status !== 0) return 'absent';
  return r.stdout.trim() === 'true' ? 'running' : 'stopped';
}

function sh(args) {
  const r = run(rt, args, { stdio: 'inherit' });
  if (r.status !== 0) fail(`${rt} ${args.join(' ')} failed`);
}

switch (cmd) {
  case 'up': {
    const s = state();
    if (s === 'running') console.log(`✔ ${AZURITE_NAME} already running`);
    else if (s === 'stopped') sh(['start', AZURITE_NAME]);
    else
      sh([
        'run', '-d', '--name', AZURITE_NAME,
        '-p', `127.0.0.1:${port}:10000`,
        '-v', `${AZURITE_VOLUME}:/data`,
        AZURITE_IMAGE,
        'azurite-blob', '--blobHost', '0.0.0.0', '--location', '/data', '--skipApiVersionCheck',
      ]);
    console.log(`✔ Azurite blob endpoint: http://127.0.0.1:${port}/devstoreaccount1 (via ${rt})`);
    break;
  }
  case 'down':
    if (state() === 'absent') console.log('Azurite container not present');
    else sh(['rm', '-f', AZURITE_NAME]);
    console.log(`(data kept in volume ${AZURITE_VOLUME}; remove with: ${rt} volume rm ${AZURITE_VOLUME})`);
    break;
  case 'status': {
    const s = state();
    console.log(`${AZURITE_NAME}: ${s} (${rt})`);
    process.exit(s === 'running' ? 0 : 1);
  }
  case 'nuke': {
    // Everything Azurite left on this machine: container, the volume holding all uploaded blobs, the image.
    // Each step is best-effort so a missing piece doesn't stop the rest.
    // `rm -f` exits 0 even when the target is missing, so probe with inspect to report truthfully.
    const steps = [
      ['container', ['inspect', AZURITE_NAME], ['rm', '-f', AZURITE_NAME]],
      ['volume (all uploaded images)', ['volume', 'inspect', AZURITE_VOLUME], ['volume', 'rm', '-f', AZURITE_VOLUME]],
      ['image', ['image', 'inspect', AZURITE_IMAGE], ['rmi', '-f', AZURITE_IMAGE]],
    ];
    for (const [what, probe, remove] of steps) {
      if (run(rt, probe).status !== 0) {
        console.log(`– ${what}: not present`);
        continue;
      }
      const r = run(rt, remove);
      if (r.status !== 0) fail(`${rt} ${remove.join(' ')} failed: ${(r.stderr || '').trim()}`);
      console.log(`✔ ${what}: removed`);
    }
    console.log('A running server recreates its blob container on the next request; no restart needed.');
    break;
  }
}
