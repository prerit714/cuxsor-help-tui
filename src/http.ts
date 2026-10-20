import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ErrorRequestHandler, Express, RequestHandler } from 'express';
import multer from 'multer';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './mcp.js';
import { ImageError, type ImageStore } from './storage.js';

// Resolves to <repo>/public from both src/ (tsx) and dist/ (built output).
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export type AppOptions = { host: string; maxUploadBytes: number; uiUrl?: string };

export function createApp(store: ImageStore, opts: AppOptions): Express {
  // Adds Host-header validation (DNS-rebinding protection) when bound to localhost, plus express.json().
  const app = createMcpExpressApp({ host: opts.host });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: opts.maxUploadBytes, files: 20 } });

  // ---- MCP (stateless Streamable HTTP: new server + transport per request) ----
  app.post('/mcp', async (req, res) => {
    const server = buildMcpServer(store, opts.uiUrl);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const methodNotAllowed: RequestHandler = (_req, res) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  // ---- REST API used by the browser UI ----
  app.post('/api/images', upload.array('file'), async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new ImageError('No files uploaded (multipart field "file")', 400);
    const saved = [];
    for (const f of files) {
      // multer decodes the filename as latin1; re-decode so non-ASCII names survive.
      const info = await store.put(f.buffer, Buffer.from(f.originalname, 'latin1').toString('utf8'));
      saved.push({ ...info, url: `/api/images/${info.id}` });
    }
    res.status(201).json(saved);
  });

  app.get('/api/images', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json(await store.list(limit));
  });

  app.get('/api/images/:id', async (req, res) => {
    const img = await store.get(req.params.id);
    if (!img) throw new ImageError('Not found', 404);
    res
      .type(img.info.mimeType)
      .set('Cache-Control', 'private, max-age=31536000, immutable') // ids are never reused
      .set('X-Content-Type-Options', 'nosniff')
      .send(img.data);
  });

  app.delete('/api/images/:id', async (req, res) => {
    const deleted = await store.delete(req.params.id);
    if (!deleted) throw new ImageError('Not found', 404);
    res.status(204).end();
  });

  // ---- UI + health ----
  app.get('/', (_req, res) => res.redirect('/ui'));
  app.get('/ui', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  app.get('/healthz', async (_req, res) => {
    const storage = await store.ping();
    res.status(storage ? 200 : 503).json({ ok: storage, storage });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof ImageError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      return void res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  };
  app.use(onError);

  return app;
}
