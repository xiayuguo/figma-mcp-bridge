#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Node } from "./node.js";
import { Election } from "./election.js";
import { registerTools } from "./tools.js";
import { VERSION } from "./version.js";

// Overridable so a fork/test instance can run beside a stock 1994 bridge
// without joining its leader election. The plugin must be built with the
// matching VITE_FIGMA_BRIDGE_WS URL (which must also be listed in the
// plugin manifest's networkAccess.allowedDomains).
function resolvePort(): number {
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
 * Resolve the leader URL for follower-to-leader HTTP calls.
 * Defaults to localhost when FIGMA_BRIDGE_LEADER_URL is not set,
 * enabling same-machine leader election out of the box.
 * Set FIGMA_BRIDGE_LEADER_URL to a host:port string (e.g. "192.168.1.100:1994")
 * to point a follower at a remote leader across machines.
 */
function resolveLeaderUrl(port: number): string {
  const raw = process.env.FIGMA_BRIDGE_LEADER_URL;
  if (raw !== undefined && raw.trim() !== "") {
    return `http://${raw.trim()}`;
  }
  return `http://localhost:${port}`;
}

async function main(): Promise<void> {
  const LEADER_URL = resolveLeaderUrl(PORT);
  const node = new Node(PORT, LEADER_URL);
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
