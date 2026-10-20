import { loadConfig } from './config.js';
import { createApp } from './http.js';
import { ImageStore } from './storage.js';

const config = loadConfig();
const store = new ImageStore(config.connectionString, config.container);

try {
  await store.ensureContainer();
} catch (err) {
  console.error(
    `Cannot reach blob storage (${(err as Error).message}).\nIs Azurite running? Start it with: npm run azurite:up`,
  );
  process.exit(1);
}

const base = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
const app = createApp(store, { host: config.host, maxUploadBytes: config.maxUploadBytes, uiUrl: `${base}/ui` });

const server = app.listen(config.port, config.host, () => {
  console.log(`Upload UI:   ${base}/ui`);
  console.log(`MCP (HTTP):  ${base}/mcp`);
  console.log(`Add to Claude Code: claude mcp add --transport http image-bridge ${base}/mcp`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close(() => process.exit(0)));
