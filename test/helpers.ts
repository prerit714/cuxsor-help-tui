import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { AZURITE_DEV_CONNECTION_STRING } from '../src/config.js';
import { createApp } from '../src/http.js';
import { ImageStore } from '../src/storage.js';

/** 1x1 transparent PNG. */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || AZURITE_DEV_CONNECTION_STRING;

/** A store on a unique, throwaway container so test runs never touch real data or each other. */
export function tempStore(): ImageStore {
  return new ImageStore(connectionString, `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

/** Probes storage once so suites can skip (instead of fail) when Azurite isn't running. */
export async function azuriteAvailable(): Promise<boolean> {
  const store = tempStore();
  try {
    await store.ensureContainer();
    await store.destroy();
    return true;
  } catch {
    console.warn('Azurite not reachable; skipping storage-backed tests. Run: npm run azurite:up');
    return false;
  }
}

export async function startServer(store: ImageStore, maxUploadBytes = 1024 * 1024) {
  const app = createApp(store, { host: '127.0.0.1', maxUploadBytes });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export async function uploadVia(base: string, data: Buffer, name = 'pixel.png') {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(data)]), name);
  return fetch(`${base}/api/images`, { method: 'POST', body: fd });
}
