import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG_1PX, azuriteAvailable, startServer, tempStore, uploadVia } from './helpers.js';

describe.skipIf(!(await azuriteAvailable()))('HTTP API', () => {
  const store = tempStore();
  let srv: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    await store.ensureContainer();
    srv = await startServer(store, 1024);
  });
  afterAll(async () => {
    await srv.close();
    await store.destroy();
  });

  it('uploads, serves, lists and deletes', async () => {
    const res = await uploadVia(srv.base, PNG_1PX);
    expect(res.status).toBe(201);
    const [img] = await res.json();

    const raw = await fetch(`${srv.base}${img.url}`);
    expect(raw.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await raw.arrayBuffer()).equals(PNG_1PX)).toBe(true);

    const list = await (await fetch(`${srv.base}/api/images`)).json();
    expect(list.map((i: { id: string }) => i.id)).toContain(img.id);

    expect((await fetch(`${srv.base}/api/images/${img.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(`${srv.base}/api/images/${img.id}`)).status).toBe(404);
  });

  it('rejects non-images (415) and oversized uploads (413)', async () => {
    expect((await uploadVia(srv.base, Buffer.from('not an image'))).status).toBe(415);
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(2048)]);
    expect((await uploadVia(srv.base, big)).status).toBe(413);
  });

  it('serves the UI and health check', async () => {
    const ui = await fetch(`${srv.base}/ui`);
    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain('Image Bridge');
    expect(await (await fetch(`${srv.base}/healthz`)).json()).toEqual({ ok: true, storage: true });
  });

  it('rejects foreign Host headers (DNS rebinding protection)', async () => {
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(`${srv.base}/healthz`);
      request({ host: u.hostname, port: u.port, path: u.pathname, headers: { Host: 'evil.example' } }, (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      })
        .on('error', reject)
        .end();
    });
    expect(status).toBe(403);
  });
});
