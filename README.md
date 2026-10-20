# cuxsor-help-tui: Image Bridge MCP

Some terminal AI clients can't paste images. This server works around that:

1. Open the browser UI and paste (**Alt+V**), drop, or pick an image. Its id (`img__<uuid>`) is copied to your clipboard; **Alt+C** copies the newest one again.
2. In your TUI, paste the id and ask your question. Ids start with `img__` on purpose: the bundled Claude Code skill triggers on that prefix and calls the MCP tool `get_image` without you having to ask.

Images are stored in [Azurite](https://github.com/Azure/Azurite) (the local Azure Blob emulator) running under Docker or Podman.

## Requirements

- Node ≥ 22
- Docker or Podman. Set `CONTAINER_RUNTIME=podman` to force Podman. Without it, Docker is tried first.

## Usage

```sh
npm install
npm run azurite:up
npm run dev            # or: npm run build && npm start
```

- Upload UI: http://127.0.0.1:3333/ui
- MCP endpoint (Streamable HTTP): http://127.0.0.1:3333/mcp

Register the server in every MCP client it detects (currently Claude Code and Cursor):

```sh
npm run setup:clients                       # user/global scope, all detected clients
npm run setup:clients -- --dry-run          # show what would change
npm run setup:clients -- --only cursor      # just one client
npm run setup:clients -- --scope project    # ./.mcp.json (Claude Code) and ./.cursor/mcp.json (Cursor)
npm run setup:clients -- --remove           # unregister
```

Other flags are `--name` (default `image-bridge`) and `--url` (default built from `HOST`/`PORT`). Re-running the command is safe. Claude Code is configured through `claude mcp add`, and the `image-bridge` skill (`skills/image-bridge/SKILL.md`) is copied to `~/.claude/skills/` so that any `img__…` id in a conversation makes Claude fetch the image automatically. For Cursor, the script merges an entry into `mcp.json`, keeps the existing servers, and saves the previous file as `mcp.json.bak`. Cursor gets no equivalent skill, so there you ask it explicitly to look at the id.

### Linux and WSL

Everything is plain Node, so it works the same on Linux, macOS, WSL and Windows. On WSL, a few things work differently:

- **Install dependencies separately on each OS.** `tsx` and `vitest` ship platform-specific binaries, so a `node_modules` installed on Windows won't run in WSL, and the reverse is also true. Keep separate checkouts, or run `npm ci` again when you switch.
- **Run the server inside WSL.** Windows apps (your browser, Cursor) reach it at `127.0.0.1` through WSL's localhost forwarding. With the default NAT networking, WSL can't reach a server bound to Windows' `127.0.0.1`. To run the server on Windows and the clients in WSL, set `networkingMode=mirrored` in `.wslconfig`.
- **Container runtime:** turn on Docker Desktop → Settings → Resources → WSL integration for your distro, or install podman inside it. `npm run check-tools` tells you if you only have Docker Desktop's placeholder `docker`.
- **`setup:clients`** configures the Claude Code CLI installed inside WSL. For Cursor, it writes the **Windows** profile's `.cursor/mcp.json`, because Cursor runs on Windows. It finds that profile through WSL interop. If interop is broken, which is common on systemd distros such as Arch, it uses the single `/mnt/c/Users/*` profile that has a `.cursor` folder. Use `--cursor-home <dir>` to set it explicitly.

### MCP tools

| Tool | Purpose |
| --- | --- |
| `get_image { id }` | Returns the image (base64 image content) plus filename, type and size. `id` is `img__<uuid>`; a bare UUID is accepted too |
| `list_images { limit? }` | Recent uploads, newest first |
| `delete_image { id }` | Deletes an image |

Paste uses **Alt+V** rather than Ctrl+V, reading the clipboard through the async Clipboard API. Chrome and Edge ask for clipboard permission the first time; Firefox supports it from version 127.

### Browsing images

The gallery below the drop zone lists every upload, newest first, with a filter box (filename or id). Click a thumbnail to open it in a side drawer: full-size view, id (click to select), file details, **Copy id**, **Open** (raw image in a new tab), **Download**, and **Delete** with an inline confirmation. Use ← / → to step through images and Esc or a click outside to close. The sun/moon button toggles light/dark; the theme follows your system until you choose one, and the choice is shared with trpc-portfolio (same `theme` key).

### Configuration

All settings are environment variables. See `.env.example`: `HOST`, `PORT`, `AZURE_STORAGE_CONNECTION_STRING`, `BLOB_CONTAINER`, `MAX_UPLOAD_MB` (default 5), `CONTAINER_RUNTIME`, `AZURITE_PORT`.

The server binds to `127.0.0.1` and rejects requests with a foreign `Host` header, which protects against DNS rebinding. It has no authentication, so don't expose it beyond localhost.

### Scripts

| Script | |
| --- | --- |
| `npm run azurite:up` / `down` / `status` | Manage the Azurite container. Data persists in volume `cuxsor-azurite-data` |
| `npm run azurite:nuke` | Remove the container, the data volume (**deletes every uploaded image**) and the Azurite image. A running server keeps working after the next `azurite:up` |
| `npm run setup:clients` | Registers or unregisters the MCP server in Claude Code and Cursor (see above) |
| `npm run check-tools` | Checks the Node version and that docker/podman is available |
| `npm run health` | Exits 0 when the server is up and storage is reachable |
| `npm test` | Vitest. Storage-backed tests are skipped when Azurite isn't running |
