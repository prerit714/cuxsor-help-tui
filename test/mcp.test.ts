import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PNG_1PX, azuriteAvailable, startServer, tempStore, uploadVia } from './helpers.js';

type Content = { type: string; text?: string; data?: string; mimeType?: string }[];

describe.skipIf(!(await azuriteAvailable()))('MCP tools', () => {
  const store = tempStore();
  let srv: Awaited<ReturnType<typeof startServer>>;
  let client: Client;

  beforeAll(async () => {
    await store.ensureContainer();
    srv = await startServer(store);
    client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${srv.base}/mcp`)));
  });
  afterAll(async () => {
    await client.close();
    await srv.close();
    await store.destroy();
  });

  it('exposes the image tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['delete_image', 'get_image', 'list_images']);
  });

  it('get_image returns the uploaded image as an image content block', async () => {
    const [img] = await (await uploadVia(srv.base, PNG_1PX, 'shot.png')).json();
    expect(img.id).toMatch(/^img__/);
    const res = await client.callTool({ name: 'get_image', arguments: { id: img.id } });
    const content = res.content as Content;
    expect(content[0]).toEqual({ type: 'image', mimeType: 'image/png', data: PNG_1PX.toString('base64') });
    expect(content[1].text).toContain('shot.png');

    const list = await client.callTool({ name: 'list_images', arguments: {} });
    expect((list.content as Content)[0].text).toContain(img.id);
  });

  it('get_image reports unknown and malformed ids as tool errors', async () => {
    const missing = await client.callTool({
      name: 'get_image',
      arguments: { id: 'img__00000000-0000-4000-8000-000000000000' },
    });
    expect(missing.isError).toBe(true);
    const bad = await client.callTool({ name: 'get_image', arguments: { id: 'nope' } });
    expect(bad.isError).toBe(true);
  });
});
