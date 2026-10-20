import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImageError, isImageId, newImageId, normalizeImageId, sniffImageMime } from '../src/storage.js';
import { PNG_1PX, azuriteAvailable, tempStore } from './helpers.js';

describe('image ids', () => {
  it('are img__<uuid> and normalize leniently', () => {
    const id = newImageId();
    expect(id).toMatch(/^img__[0-9a-f-]{36}$/);
    expect(isImageId(id)).toBe(true);
    expect(normalizeImageId(`  ${id.toUpperCase()} `)).toBe(id);
    expect(normalizeImageId(id.slice('img__'.length))).toBe(id); // bare uuid gets the prefix
    expect(normalizeImageId('img__nope')).toBeNull();
    expect(normalizeImageId('../etc/passwd')).toBeNull();
  });
});

describe('sniffImageMime', () => {
  it('detects formats from magic bytes', () => {
    expect(sniffImageMime(PNG_1PX)).toBe('image/png');
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageMime(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffImageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});

describe.skipIf(!(await azuriteAvailable()))('ImageStore (Azurite)', () => {
  const store = tempStore();
  beforeAll(() => store.ensureContainer());
  afterAll(() => store.destroy());

  it('round-trips an image with metadata', async () => {
    const info = await store.put(PNG_1PX, 'schéma.png');
    expect(info.id.startsWith('img__')).toBe(true);
    const got = await store.get(info.id);
    expect(got?.data.equals(PNG_1PX)).toBe(true);
    expect(got?.info).toMatchObject({ id: info.id, filename: 'schéma.png', mimeType: 'image/png' });
  });

  it('rejects non-images and malformed ids', async () => {
    await expect(store.put(Buffer.from('hello'), 'x.png')).rejects.toBeInstanceOf(ImageError);
    await expect(store.get('../etc/passwd')).rejects.toMatchObject({ status: 400 });
  });

  it('returns null for unknown ids and lists newest first', async () => {
    expect(await store.get('img__00000000-0000-4000-8000-000000000000')).toBeNull();
    const a = await store.put(PNG_1PX, 'a.png');
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.put(PNG_1PX, 'b.png');
    const ids = (await store.list()).map((i) => i.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    expect(await store.delete(a.id)).toBe(true);
    expect(await store.delete(a.id)).toBe(false);
  });

  it('recreates the container if it disappears (e.g. after azurite:nuke)', async () => {
    await store.destroy();
    expect(await store.list()).toEqual([]);
    expect(await store.get('img__00000000-0000-4000-8000-000000000000')).toBeNull();
    const info = await store.put(PNG_1PX, 'after-nuke.png');
    expect((await store.get(info.id))?.info.filename).toBe('after-nuke.png');
    await store.destroy();
    expect(await store.ping()).toBe(true);
    expect(await store.list()).toEqual([]);
  });
});
