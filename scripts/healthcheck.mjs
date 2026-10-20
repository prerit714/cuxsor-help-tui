// Exit 0 if the server reports healthy (which implies Azurite is reachable), else 1.
const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT || '3333';
const url = `http://${host}:${port}/healthz`;
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  const body = await res.text();
  console.log(`${res.status} ${body}`);
  process.exit(res.ok ? 0 : 1);
} catch (err) {
  console.error(`✖ ${url} unreachable: ${err.cause?.code ?? err.message}`);
  process.exit(1);
}
