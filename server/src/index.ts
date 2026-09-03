#!/usr/bin/env node

import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Node } from "./node.js";
import { Election } from "./election.js";
import { registerTools } from "./tools.js";
import { VERSION } from "./version.js";

interface CliValues {
  "leader-url"?: string;
  port?: string;
  host?: string;
}

const CLI_OPTIONS = {
  "leader-url": { type: "string" },
  port: { type: "string" },
  host: { type: "string" },
} as const;

function printHelp(): void {
  console.log(`\
figma-bridge v${VERSION}

Usage: node index.js [OPTIONS]

Options:
  --leader-url <host:port>  URL of the leader node for cross-machine election
                            (e.g. 192.168.1.100:1994)
                            Env: FIGMA_BRIDGE_LEADER_URL
  --port <port>             Port to listen on (default: 1994)
                            Env: FIGMA_BRIDGE_PORT
  --host <address>          Host to bind the leader HTTP server on (default: 0.0.0.0)
                            Env: FIGMA_BRIDGE_HOST
  -h, --help                Show this help message
`);
}

function parseCliOptions(): CliValues {
  try {
    const result = parseArgs({ options: CLI_OPTIONS, allowPositionals: false });
    return result.values as CliValues;
  } catch {
    return {};
  }
}

// Check for --help / -h BEFORE parseArgs so unknown flags don't throw us into the catch
if (process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  printHelp();
  process.exit(0);
}

const cli: CliValues = parseCliOptions();

// Overridable so a fork/test instance can run beside a stock 1994 bridge
// without joining its leader election. The plugin must be built with the
// matching VITE_FIGMA_BRIDGE_WS URL (which must also be listed in the
// plugin manifest's networkAccess.allowedDomains).
// CLI takes precedence over env vars.
function resolvePort(): number {
  // CLI: --port
  if (cli.port !== undefined) {
    const port = Number(cli.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`Invalid --port "${cli.port}" — expected an integer between 1 and 65535`);
      process.exit(1);
    }
    return port;
  }
  // Env: FIGMA_BRIDGE_PORT
  const raw = process.env.FIGMA_BRIDGE_PORT;
  if (raw === undefined) return 1994;
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    // An explicitly set but invalid value must not silently join the stock
    // bridge on 1994 — fail loudly instead.
    console.error(`Invalid FIGMA_BRIDGE_PORT "${raw}" — expected an integer between 1 and 65535`);
    process.exit(1);
  }
  return port;
}
const PORT = resolvePort();

/**
 * Resolve the bind host for the leader HTTP server.
 * Defaults to all interfaces (0.0.0.0) so followers on other machines can reach it.
 * CLI: --host
 * Env: FIGMA_BRIDGE_HOST
 */
function resolveHost(): string {
  // CLI: --host
  if (cli.host !== undefined) {
    const raw = String(cli.host).trim();
    if (raw !== "") return raw;
  }
  // Env: FIGMA_BRIDGE_HOST
  const raw = process.env.FIGMA_BRIDGE_HOST;
  if (raw !== undefined && raw.trim() !== "") {
    return raw.trim();
  }
  return "0.0.0.0";
}
const HOST = resolveHost();

/**
 * Resolve the leader URL for follower-to-leader HTTP calls.
 * Defaults to localhost when FIGMA_BRIDGE_LEADER_URL / --leader-url is not set,
 * enabling same-machine leader election out of the box.
 * Set --leader-url or FIGMA_BRIDGE_LEADER_URL to a host:port string
 * (e.g. "192.168.1.100:1994") to point a follower at a remote leader across machines.
 */
function resolveLeaderUrl(port: number): string {
  // CLI: --leader-url
  if (cli["leader-url"] !== undefined) {
    const raw = String(cli["leader-url"]).trim();
    if (raw !== "") return `http://${raw}`;
  }
  // Env: FIGMA_BRIDGE_LEADER_URL
  const raw = process.env.FIGMA_BRIDGE_LEADER_URL;
  if (raw !== undefined && raw.trim() !== "") {
    return `http://${raw.trim()}`;
  }
  return `http://localhost:${port}`;
}

async function main(): Promise<void> {
  const LEADER_URL = resolveLeaderUrl(PORT);
  const node = new Node(PORT, HOST, LEADER_URL);
  const election = new Election(PORT, node, LEADER_URL);
  await election.start();

  let transport: StdioServerTransport | null = null;
  let shuttingDown = false;
  const shutdown = async (reason: string, code: number = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`Shutting down (${reason})...`);

    const force = setTimeout(() => {
      console.error("Shutdown timeout exceeded, forcing exit");
      process.exit(code);
    }, 5000);
    force.unref();

    election.stop();
    node.stop();
    if (transport) {
      try {
        await transport.close();
      } catch (err) {
        console.error("Transport close error:", err);
      }
    }
    process.exit(code);
  };

  process.stdin.on("end", () => void shutdown("stdin end"));
  process.stdin.on("close", () => void shutdown("stdin close"));

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));

  process.on("uncaughtException", async (err) => {
    console.error("Uncaught exception:", err);
    await shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
  });

  const server = new McpServer({
    name: "figma-bridge",
    version: VERSION,
  });

  registerTools(server, node, LEADER_URL);

  console.error(`Starting MCP server (role: ${node.roleName})`);

  transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
