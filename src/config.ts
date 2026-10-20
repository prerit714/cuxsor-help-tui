import { z } from 'zod';

/** Well-known Azurite development account (public, documented by Microsoft). */
export const AZURITE_DEV_CONNECTION_STRING =
  'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;' +
  'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
  'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;';

const schema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3333),
  AZURE_STORAGE_CONNECTION_STRING: z.string().default(AZURITE_DEV_CONNECTION_STRING),
  BLOB_CONTAINER: z
    .string()
    .regex(/^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/, 'invalid blob container name')
    .default('images'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(5),
});

export type Config = {
  host: string;
  port: number;
  connectionString: string;
  container: string;
  maxUploadBytes: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings as unset so a copied .env.example with blanks still works.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const e = schema.parse(cleaned);
  return {
    host: e.HOST,
    port: e.PORT,
    connectionString: e.AZURE_STORAGE_CONNECTION_STRING,
    container: e.BLOB_CONTAINER,
    maxUploadBytes: Math.floor(e.MAX_UPLOAD_MB * 1024 * 1024),
  };
}
