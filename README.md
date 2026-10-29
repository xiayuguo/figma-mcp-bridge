# Figma MCP Bridge

[![Pairing with Hopp](https://gethopp.app/git/hopp-shield.svg?ref=hopp-repo)](https://gethopp.app)

- [Demo](#demo)
- [Quick Start](#quick-start)
- [Available Tools](#available-tools)
- [Local development](#local-development)
- [Structure](#structure)
- [How it works](#how-it-works)

<br/>

<img src="https://raw.githubusercontent.com/gethopp/figma-mcp-bridge/main/logo.png" alt="Figma MCP Bridge" align="center" />

<br/>

While other amazing Figma MCP servers like [Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP/) exist, one issues is the [API limiting](https://github.com/GLips/Figma-Context-MCP/issues/258) for free users.

The limit for free accounts is 6 requests per month, yes **per month**.

Figma MCP Bridge is a solution to this problem. It is a plugin + MCP server that streams live Figma document data to AI tools without hitting Figma API rate limits, so its Figma MCP for the rest of us ✊

It supports **multiple Figma files connected simultaneously**; open the plugin in each file and your AI agent can query any of them by `fileKey`. Single-file setups work exactly as before with no changes required.

It also includes a small, opt-in set of **write tools** for safe agent-driven edits — see [Editing Notes](#editing-notes) below.

## Demo

[Watch a demo of building a UI in Cursor with Figma MCP Bridge](https://youtu.be/ouygIhFBx0g)

[![Watch the video](https://img.youtube.com/vi/ouygIhFBx0g/maxresdefault.jpg)](https://youtu.be/ouygIhFBx0g)

## Quick Start

### Prerequisites

- Node.js 20 or newer (for `npx`)
- The Figma desktop app (development plugins can only be imported there)

### 1. Add the MCP server to your favourite AI tool

Add the following to your AI tool's MCP configuration (e.g. `~/.cursor/mcp.json` for Cursor, `~/Library/Application Support/Claude/claude_desktop_config.json` for Claude Desktop):

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "npx",
      "args": ["-y", "@xiayuguo/figma-mcp-bridge"]
    }
  }
}
```

Or add it from the command line:

```bash
# Claude Code (--scope user makes it available in every project)
claude mcp add --scope user figma-bridge -- npx -y @xiayuguo/figma-mcp-bridge

# Codex CLI (writes to ~/.codex/config.toml)
codex mcp add figma-bridge -- npx -y @xiayuguo/figma-mcp-bridge
```

For Codex, this is equivalent to adding the following to `~/.codex/config.toml`:

```toml
[mcp_servers.figma-bridge]
command = "npx"
args = ["-y", "@xiayuguo/figma-mcp-bridge"]
```

That's it — no binaries to download or install. The AI tool starts the server on demand, and it listens on `localhost:1994`.

### 2. Add the Figma plugin

1. Download `figma-mcp-bridge-vX.Y.Z.zip` from the [latest release](https://github.com/xiayuguo/figma-mcp-bridge/releases) page.
2. Unzip it somewhere permanent (e.g. `~/figma-plugins/figma-mcp-bridge/`). Figma loads the plugin from this path every time, so don't delete or move it.
3. In the Figma desktop app, go to `Plugins > Development > Import plugin from manifest` and select the `manifest.json` file from the `plugin/` folder.

### 3. Start using it 🎉

1. Start your AI tool, which launches the MCP server.
2. Open a Figma file and run `Plugins > Development > Figma MCP Bridge`.
3. Ask your AI tool to call `list_files`. If the file shows up, you're connected — paste a Figma link and start prompting.

To work across multiple files, just open the plugin in each Figma file. The bridge keeps all connections active and your AI agent can target any of them by `fileKey`.

### Notes

- **Keep the default port.** The plugin's `manifest.json` only allows connections to `ws://localhost:1994`, so changing `--port` / `FIGMA_BRIDGE_PORT` will stop the plugin from connecting.
- **Opening links automatically.** `open_figma_url` (and read tools given a `url`) drive the Figma desktop app via macOS UI automation. Grant Accessibility permission to the app hosting the MCP server (Terminal, Cursor, Claude, …) in `System Settings > Privacy & Security > Accessibility`, keep the screen unlocked, and use an ASCII input source.
- **AI tool on a different machine.** Run the server on the Figma machine as the leader with `--host 0.0.0.0`, and set `FIGMA_BRIDGE_LEADER_URL=<leader-ip>:1994` in the other machine's MCP config `env`. See [Leader / Follower mode](#leader--follower-mode-multi-machine-setup).

If you want to know more about how it works, read the [How it works](#how-it-works) section.

## Available Tools

| Tool                           | Description                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `list_files`                   | List all connected Figma files (supports multi-file workflows)                         |
| `open_figma_url`               | Open a Figma link on the leader Mac and wait until its plugin connects (idempotent)    |
| `get_document`                 | Get the current Figma page document tree                                               |
| `get_selection`                | Get the currently selected nodes in Figma                                              |
| `get_node`                     | Get a specific Figma node by ID (colon format, e.g. `4029:12345`)                      |
| `get_styles`                   | Get all local paint, text, effect, and grid styles                                     |
| `get_metadata`                 | Get file name, pages, and current page info                                            |
| `get_design_context`           | Get a depth-limited tree optimized for understanding design context                    |
| `get_variable_defs`            | Get all variable collections, modes, and values (design tokens)                        |
| `get_screenshot`               | Export nodes as PNG/SVG/JPG/PDF (base64-encoded)                                       |
| `save_screenshots`             | Export and save screenshots directly to the local filesystem                           |
| `get_motion_styles`            | List all available animation presets (beta)                                            |
| `get_node_motion`              | Read a node's current animation styles and properties (beta)                           |
| `apply_animation_style`        | Apply a preset animation style to a node (beta)                                        |
| `remove_animation_style`       | Remove an applied animation style from a node (beta)                                   |
| `apply_manual_keyframe_track`  | Apply a manual keyframe track to a node property (beta)                                |
| `remove_manual_keyframe_track` | Remove a manual keyframe track from a node property (beta)                             |
| `set_timeline_duration`        | Set the duration of a timeline in seconds (beta)                                       |
| `set_node_visibility`          | Show or hide specific nodes                                                            |
| `set_text_content`             | Replace the contents of a text node                                                    |
| `set_text_properties`          | Patch font, size, alignment, auto-resize, color, and bounds on a text node             |
| `set_node_properties`          | Patch common node properties: name, position, size, visibility, opacity, corner radius |
| `set_solid_fill`               | Replace a node's fill or stroke with a single solid paint                              |
| `set_gradient_fill`            | Replace a node's fill or stroke with a linear/radial/angular/diamond gradient          |
| `set_effects`                  | Replace a node's effects list (drop/inner shadows, layer/background blurs)             |
| `set_stroke_properties`        | Patch stroke weight, align, dash pattern, cap, and join                                |
| `set_auto_layout`              | Configure auto-layout direction, padding, gap, alignment, sizing, and wrap             |
| `create_page`                  | Create a new page in the document, optionally switching to it                          |
| `create_frame`                 | Create a new frame, optionally under a parent                                          |
| `create_text`                  | Create a new text node                                                                 |
| `create_shape`                 | Create a rectangle, ellipse, or line                                                   |
| `create_image`                 | Create an image-backed rectangle from a local path, URL, or data URI                   |
| `import_html_layers`           | Bulk-import an html-figma layer tree (JSON) as frames, text, rectangles, and vectors   |
| `duplicate_nodes`              | Duplicate nodes in place                                                               |
| `reparent_nodes`               | Move nodes into another parent                                                         |
| `group_nodes`                  | Wrap a list of nodes (sharing a parent) in a new group                                 |
| `ungroup_node`                 | Ungroup a group or frame — children move up to its parent                              |
| `set_selection`                | Set the page selection to a list of node IDs (works in Dev Mode)                       |
| `scroll_and_zoom_into_view`    | Frame the viewport around the given nodes (works in Dev Mode)                          |
| `delete_nodes`                 | Delete nodes with explicit confirmation                                                |

File operations accept an optional `fileKey` parameter when multiple Figma files are connected. Use `list_files` to discover connected files and their keys.

`open_figma_url` makes sure a Figma file is connected. It routes to the leader Mac. If that file's plugin is already connected, it returns immediately. Otherwise it opens the link in the Figma desktop app, runs **Plugins → Development → Figma MCP Bridge** through macOS UI automation, and returns only once the plugin for that `fileKey` has connected. If the English menu path is missing, it falls back to Quick Actions (⌘/). If the plugin does not connect in time, it retries the launch once. Concurrent calls for the same file share one launch.

The read tools (`get_document`, `get_selection`, `get_node`, `get_styles`, `get_metadata`, `get_design_context`, `get_variable_defs`, `get_screenshot`) also accept a `url` parameter. Pass the link the user pasted: the file is opened on demand, its `fileKey` is used, and `get_node` / `get_screenshot` default to the link's `node-id`. Other pages of an already-connected file need no reopening, because nodes on any page are reachable by ID.

Leader Mac requirements: import this repository's plugin (set `FIGMA_BRIDGE_PLUGIN_NAME` if you renamed it), grant Accessibility permission to the process hosting the server in System Settings, and keep the desktop session logged in and unlocked. Keep the input source set to an ASCII layout so the Quick Actions fallback can type the plugin name. For remote use, point the follower's `FIGMA_BRIDGE_LEADER_URL` at that Mac.

### Editing Notes

- Edit tools work only when the plugin is opened in Figma's design editor (Dev Mode is read-only — they will return a clear error there).
- The current user must have permission to edit the target file.
- `delete_nodes` is intentionally gated behind `confirm: true`.
- Text edits automatically load the fonts currently used by the target text node before applying the new content.
- New text nodes default to `Inter Regular` unless a font is provided.
- `create_image` reads local paths relative to the MCP server working directory unless you pass an absolute path.
- `import_html_layers` takes a JSON file produced by [html-figma](https://github.com/sergcen/html-to-figma)'s browser `htmlToFigma()`. The path resolves relative to the MCP server working directory and must stay inside it, even when absolute. Everything lands inside one wrapper frame, and the response reports `layerCount` against `expectedLayerCount` so partial imports are visible.
- `create_page` returns the new page's ID — pass it as `parentId` to `create_frame` / `create_text` / `create_shape` / `create_image` to author content on that page without switching the editor.

### What You Can Build

With the current write surface, an agent can build a basic slide deck in a new empty Figma file: create slide frames, style titles and body copy, lay out rectangles/ellipses/lines for cards and dividers, duplicate slide templates, reparent content into the right frame, and adjust common geometry/visual properties — including solid/gradient paints, shadows and blurs, stroke geometry, and auto-layout configuration.

The current version is intentionally limited — no components/instances, no variables/styles authoring, no per-segment text styling, and no vector boolean operations yet.

## Local development

This repo uses [Bun](https://bun.sh) as its package manager and script runner throughout. Install it first if you don't have it.

#### 1. Clone this repository locally

```bash
git clone git@github.com:xiayuguo/figma-mcp-bridge.git
```

#### 2. Install root tooling

Install the root dependencies once. This runs Husky's `prepare` script, which installs the Git pre-commit hook that formats staged files with Prettier.

```bash
cd figma-mcp-bridge && bun install
```

#### 3. Build the server

```bash
cd server && bun install && bun run build
```

#### 4. Build the plugin

```bash
cd plugin && bun install && bun run build
```

#### 5. Add the MCP server to your favourite AI tool

For local development, add the following to your AI tool's MCP config:

```json
{
  "figma-bridge": {
    "command": "node",
    "args": ["/path/to/figma-mcp-bridge/server/dist/index.js"]
  }
}
```

### Leader / Follower mode (multi-machine setup)

The MCP server can run in two roles:

- **Leader** — binds the WebSocket server on port 1994 (default), accepts connections from Figma plugins
- **Follower** — connects to a leader via HTTP and proxies all tool calls through it; useful when the AI tool runs on a different machine than the Figma plugin

#### Start a leader (primary)

```bash
cd server && bun run build
node dist/index.js
# Or with custom port/host:
node dist/index.js --port 1994 --host 0.0.0.0
```

#### Start a follower

```bash
cd server && bun run build
# Point --leader-url at the leader's HTTP endpoint:
node dist/index.js --leader-url 192.168.1.100:1994
# Or via env var:
FIGMA_BRIDGE_LEADER_URL=192.168.1.100:1994 node dist/index.js
```

The follower will automatically ping the leader's `/ping` endpoint to detect if the leader dies, and will attempt to take over if it does.

### Code style

The repo is formatted with [Prettier](https://prettier.io) (config in `.prettierrc`). A Husky pre-commit hook runs `lint-staged`, which formats only your staged files, so commits stay formatted automatically. You can also run it manually:

```bash
bun run format        # format the whole repo
bun run format:check  # verify formatting without writing (useful in CI)
```

## Structure

```
Figma-MCP-Bridge/
├── plugin/   # Figma plugin (TypeScript/React)
└── server/   # MCP server (TypeScript/Node.js)
    └── src/
        ├── index.ts      # Entry point
        ├── bridge.ts     # WebSocket bridge to Figma plugin
        ├── leader.ts     # Leader: HTTP server + bridge
        ├── follower.ts   # Follower: proxies to leader via HTTP
        ├── node.ts       # Dynamic leader/follower role switching
        ├── election.ts   # Leader election & health monitoring
        ├── tools.ts      # MCP tool definitions
        └── types.ts      # Shared types
```

## How it works

There are two main components to the Figma MCP Bridge:

### 1. The Figma Plugin

The Figma plugin is the user interface for the Figma MCP Bridge. You run this inside the Figma file you want to use the MCP server for, and its responsible for getting you all the information you need.

### 2. The MCP Server

The MCP server is the core of the Figma MCP Bridge. It maintains a registry of WebSocket connections keyed by `fileKey`, so multiple Figma files can be connected simultaneously. The server is responsible for:

- Handling WebSocket connections from one or more Figma plugin instances
- Routing tool calls to the correct file based on `fileKey`
- Forwarding responses back to the AI client
- Handling leader election (as we can have only one WS connection to an MCP server at a time)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FIGMA (Browser)                                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Figma Plugin                                  │  │
│  │                    (TypeScript/React)                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ WebSocket
                                      │ (ws://localhost:1994/ws)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRIMARY MCP SERVER                                 │
│                         (Leader on :1994)                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Bridge                                    Endpoints:               │    │
│  │  • Manages WebSocket conn                  • /ws    (plugin)        │    │
│  │  • Forwards requests to plugin             • /ping  (health)        │    │
│  │  • Routes responses back                   • /rpc   (followers)     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                           ▲                              ▲
                           │ HTTP /rpc                    │ HTTP /rpc
                           │ POST requests                │ POST requests
                           │                              │
         ┌─────────────────┴───────────┐    ┌─────────────┴───────────────┐
         │    FOLLOWER MCP SERVER 1    │    │    FOLLOWER MCP SERVER 2    │
         │                             │    │                             │
         │  • Pings leader /ping       │    │  • Pings leader /ping       │
         │  • Forwards tool calls      │    │  • Forwards tool calls      │
         │    via HTTP /rpc            │    │    via HTTP /rpc            │
         │  • If leader dies →         │    │  • If leader dies →         │
         │    attempts takeover        │    │    attempts takeover        │
         └─────────────────────────────┘    └─────────────────────────────┘
                    ▲                                      ▲
                    │                                      │
                    │ MCP Protocol                         │ MCP Protocol
                    │ (stdio)                              │ (stdio)
                    ▼                                      ▼
         ┌─────────────────────────────┐    ┌─────────────────────────────┐
         │      AI Tool / IDE 1        │    │      AI Tool / IDE 2        │
         │      (e.g., Cursor)         │    │      (e.g., Cursor)         │
         └─────────────────────────────┘    └─────────────────────────────┘
```
