# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An HTTP MCP server with a browser upload UI. It exists because some terminal AI clients (TUIs) can't paste images. The user uploads or pastes images at `/ui`, copies an image's id, and the MCP client calls `get_image` with that id to receive the image. Images are stored in Azurite (the local Azure Blob emulator), which runs in Docker or Podman.

Image ids are always `img__<uuid>`. The prefix is the trigger: `skills/image-bridge/SKILL.md` is a Claude Code skill whose description fires on `img__`, telling the model to call `get_image`. `setup:clients` installs that skill alongside the MCP registration. Don't change the prefix without updating the skill, `normalizeImageId`, and the MCP tool descriptions together.

## Commands

```sh
npm run azurite:up        # start Azurite (blob only, 127.0.0.1:10000, named volume cuxsor-azurite-data)
npm run azurite:status    # exit 0 only if the container is running
npm run azurite:down      # remove the container; the data volume is kept
npm run azurite:nuke      # remove container + data volume (all uploads) + the Azurite image; reports what it found
npm run dev               # tsx watch; the predev hook runs scripts/check-tools.mjs first
npm run build && npm start
npm run typecheck
npm test                                       # vitest; needs Azurite running
npx vitest run test/mcp.test.ts -t "get_image" # single file / single test
npm run health            # GETs /healthz; exits 0 only if the server is up and storage is reachable
npm run setup:clients -- --dry-run   # register the MCP in detected clients (Claude Code, Cursor); also --only, --scope, --remove
```

Tests that use storage call `describe.skipIf(!(await azuriteAvailable()))`. If Azurite is down, they **skip silently instead of failing**. When you see a test run with few or no executed tests, check `npm run azurite:status`. Each suite uses its own throwaway `test-*` container and deletes it afterwards.

## Architecture

- `src/storage.ts`: `ImageStore` is the only code that talks to Azure Blob. The **blob name is the image UUID** handed to clients. Blob metadata holds `originalname` (URI-encoded, because metadata travels as HTTP headers) and `uploadedat`. The content type comes from **magic-byte sniffing** (`sniffImageMime`). The client-declared MIME type is ignored. Only PNG, JPEG, GIF and WebP are accepted. `normalizeImageId` validates ids before any blob call; it accepts `img__<uuid>` in any case, plus a bare UUID (prefix added), and rejects everything else. `get`/`delete` take the raw string and normalize it themselves, so callers don't need to. The SDK client uses minimal retries so the UI and `/healthz` fail fast when Azurite is down. Every blob operation goes through `withContainer`, which recreates the blob container and retries once on `ContainerNotFound`, and `ping()` uses `createIfNotExists`, so a running server survives `azurite:nuke` + `azurite:up` without a restart. Keep new operations inside `withContainer`.
- `src/mcp.ts`: `buildMcpServer()` registers `get_image` (returns an `image` content block plus a text description), `list_images`, and `delete_image`. Storage errors that the user caused come back as `isError` tool results, not thrown exceptions.
- `src/http.ts`: `createApp()` builds on the SDK's `createMcpExpressApp`, which adds Host-header DNS-rebinding protection when bound to localhost, plus `express.json()`. MCP runs in **stateless Streamable HTTP mode**: every `POST /mcp` creates a new `McpServer` and transport, and `GET`/`DELETE /mcp` return 405. The browser UI uses the REST routes under `/api/images` (multer memory storage, field `file`). The UI and MCP tools share one `ImageStore`. Errors go through `ImageError(status)`, and the final error handler maps them to HTTP status codes.
- `public/index.html`: the whole UI, written in vanilla JS with no build step. The server finds it via `../public` relative to the module, so the same path works from `src/` (tsx) and `dist/` (built). Paste is **Alt+V**, not Ctrl+V: the native `paste` event is intentionally not used, and Alt+V reads via `navigator.clipboard.read()` (needs a secure context and a one-time permission). Alt+C copies the newest image's id. Key matching uses `e.code` because macOS Option+V yields `√` as `e.key`.
  - **Theme is borrowed from `../trpc-portfolio`** (`packages/client/src/index.css`): the same RGB-triplet tokens (`--background`, `--foreground`, `--muted`, `--muted-foreground`, `--code-background`), slate light / Gruvbox dark, switched by a `.dark` class on `<html>` and persisted under the localStorage key `theme` (`light`|`dark`), EB Garamond + Fira Code from Google Fonts, 8px radius, 300ms colour transitions, the same scrollbar rules and bottom-right sun/moon FAB. Keep both in sync if the portfolio's tokens change. `--accent`/`--destructive` are additions (the portfolio has none).
  - The image viewer is a right-side **drawer**: a `<dialog>` opened with `showModal()`, `closedby="any"` for light-dismiss plus a click-outside fallback, entry via `@starting-style`, exit via `data-closing` when the browser lacks `overlay`/discrete `display` transitions (Firefox/Safari). ←/→ browse within the filtered list, Esc closes, delete is a two-step inline confirm. Thumbnails are a fixed 4:3 box with an absolutely positioned `<img>`, otherwise tall images stretch the card.
  - To check the page visually without a connected browser extension: `mcp__rea__capture_browser_scenario` with Edge in `launch` mode (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`) against `http://127.0.0.1:3333/ui`; use `:first-of-type` in selectors because its locators are strict. Screenshots come back as base64 inside a large JSON result; decode them to the scratchpad and Read them.
- `src/config.ts`: environment variables validated with zod (see `.env.example`). The default connection string is the well-known Azurite `devstoreaccount1` string. `.env` is **not** loaded automatically; set variables in your shell.

## Conventions

- Setup scripts, tool checks and health checks are plain Node ESM in `scripts/` (`.mjs`, no TypeScript, no bash or PowerShell), so they work the same on Windows and Unix. Shared helpers are in `scripts/lib.mjs`.
- `scripts/setup-clients.mjs` keeps a `clients` map where each entry has `detect`, `apply` and `remove`. To support a new MCP client, add an entry there. Claude Code is configured only through its `claude mcp` CLI, never by editing `~/.claude.json` directly; the same entry copies `skills/image-bridge/` into `$CLAUDE_CONFIG_DIR/skills/` (user scope) or `./.claude/skills/` (project scope) and removes it on `--remove`. JSON-config clients go through `editJson`, which keeps other entries, writes a `.bak`, and refuses to rewrite files it can't parse. When you test it, sandbox it with `HOME`/`USERPROFILE`/`CLAUDE_CONFIG_DIR` pointing at a temp directory, or use `--dry-run`. Running it unsandboxed edits your real client configs.
- `run()` in `scripts/lib.mjs` falls back to `shell: true` on Windows so it can run `.cmd` shims. Only pass it shell-safe arguments.
- WSL: under WSL, Cursor's user config is the **Windows** profile's `.cursor/mcp.json` (see `cursorHome()`). `isWsl()` deliberately does not trust a "microsoft" kernel string on its own, because Docker Desktop containers share the WSL kernel. `windowsHome()` depends on WSL interop, which systemd distros often break, so keep the `/mnt/c/Users` fallback. In WSL, `cursor` on PATH is the Windows app's shim, so it is never used to detect Cursor.
- Tested on Windows, in Arch on WSL2, and in a `node:24` Linux container. To test Linux without touching the host's `node_modules`: `docker run --rm --network container:cuxsor-azurite -v "$PWD:/app" -v /app/node_modules -w /app node:24 sh -c "npm ci && npx vitest run"`.
- Container runtime: `$CONTAINER_RUNTIME` is used when set. Otherwise the scripts try `docker`, then `podman`. Keep runtime commands to the subset both support.
- ESM with `NodeNext` resolution: relative imports in `src/` and `test/` need the `.js` extension.
