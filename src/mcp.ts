import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ImageError, type ImageInfo, type ImageStore } from './storage.js';

function describe(i: ImageInfo): string {
  return `${i.id}  ${i.filename}  ${i.mimeType}  ${(i.size / 1024).toFixed(1)} KiB  ${i.uploadedAt}`;
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

/** Builds a fresh MCP server. Called once per request (stateless Streamable HTTP). */
export function buildMcpServer(store: ImageStore, uiUrl?: string): McpServer {
  const server = new McpServer(
    { name: 'cuxsor-image-bridge', version: '0.1.0' },
    {
      instructions:
        'Images are uploaded by the user in a browser UI' +
        (uiUrl ? ` (${uiUrl})` : '') +
        '. Every image id starts with "img__" (e.g. img__3f2a9c1e-...). Whenever such an id appears in the ' +
        'conversation, call get_image with it to view the picture before answering.',
    },
  );

  server.registerTool(
    'get_image',
    {
      title: 'Get image',
      description: 'Fetch an uploaded image by its id (img__<uuid>) and return it so you can view it.',
      inputSchema: { id: z.string().describe('Image id from the upload UI, e.g. img__3f2a9c1e-7b4d-4e1a-9c2f-0a1b2c3d4e5f') },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      try {
        const img = await store.get(id);
        if (!img) return errorResult(`No image with id ${id}`);
        return {
          content: [
            { type: 'image', data: img.data.toString('base64'), mimeType: img.info.mimeType },
            { type: 'text', text: describe(img.info) },
          ],
        };
      } catch (err) {
        if (err instanceof ImageError) return errorResult(err.message);
        throw err;
      }
    },
  );

  server.registerTool(
    'list_images',
    {
      title: 'List images',
      description: 'List recently uploaded images (newest first): id, filename, type, size, upload time.',
      inputSchema: { limit: z.number().int().min(1).max(200).default(20).describe('Max images to list') },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const images = await store.list(limit);
      const text = images.length ? images.map(describe).join('\n') : 'No images uploaded yet.';
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'delete_image',
    {
      title: 'Delete image',
      description: 'Permanently delete an uploaded image by id (img__<uuid>).',
      inputSchema: { id: z.string().describe('Image id, e.g. img__3f2a9c1e-7b4d-4e1a-9c2f-0a1b2c3d4e5f') },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      try {
        const deleted = await store.delete(id);
        return { content: [{ type: 'text', text: deleted ? `Deleted ${id}` : `No image with id ${id}` }] };
      } catch (err) {
        if (err instanceof ImageError) return errorResult(err.message);
        throw err;
      }
    },
  );

  return server;
}
