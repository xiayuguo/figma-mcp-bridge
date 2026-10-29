import { openFigmaUrl } from "./open-figma.js";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { Duplex } from "node:stream";
import { Bridge } from "./bridge.js";
import { validateRpc } from "./schema.js";
import { executeSaveScreenshots } from "./tools.js";
import type { ExportFormat } from "./tools.js";
import type { RPCRequest, RPCResponse } from "./types.js";
import { VERSION } from "./version.js";

/** Identifies this process in /ping so a node can tell its own leader apart from a remote one. */
export const INSTANCE_ID = randomUUID();

/**
 * Leader owns the WebSocket bridge to Figma and exposes HTTP endpoints for followers.
 * Endpoints:
 *   /ws   — WebSocket upgrade for the Figma plugin
 *   /ping — Health check
 *   /rpc  — JSON RPC for follower tool calls
 */
export class Leader {
  private bridge: Bridge;
  private server: http.Server | null = null;

  constructor(
    private port: number,
    private host: string = "0.0.0.0"
  ) {
    this.bridge = new Bridge();
  }

  getBridge(): Bridge {
    return this.bridge;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === "/ping" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", version: VERSION, instanceId: INSTANCE_ID }));
          return;
        }

        if (req.url === "/rpc" && req.method === "POST") {
          this.handleRPC(req, res);
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      });

      server.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
        const pathname = new URL(req.url ?? "", "http://localhost").pathname;
        if (pathname === "/ws") {
          this.bridge.handleUpgrade(req, socket, head);
        } else {
          socket.destroy();
        }
      });

      // Fail fast if port is already in use
      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          reject(new Error(`Port ${this.port} already in use`));
        } else {
          console.error("Leader HTTP server error:", err);
          if (!this.server) reject(err); // reject if during startup
        }
      });

      server.listen(this.port, this.host, () => {
        this.server = server;
        console.error(`Leader listening on ${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  private handleRPC(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const rpcReq: RPCRequest = JSON.parse(body);

        // Handle list_files as a special RPC (not forwarded to plugin)
        if (rpcReq.tool === "list_files") {
          this.sendJSON(res, 200, {
            data: this.bridge.listConnectedFiles(),
          });
          return;
        }

        if (rpcReq.tool === "open_figma_url") {
          this.sendJSON(res, 200, { data: await openFigmaUrl(rpcReq.params?.url, this.bridge) });
          return;
        }

        const validation = validateRpc(rpcReq.tool, rpcReq.nodeIds, rpcReq.params);
        if (validation.error) {
          this.sendJSON(res, 400, { error: validation.error });
          return;
        }

        // Forward the schema's output, not the caller's raw object: schemas may
        // normalise input (e.g. the create_* field aliases), and the plugin only
        // understands the canonical spelling.
        const validatedParams = validation.params ?? rpcReq.params;
        const fileKey = rpcReq.fileKey;

        // Currently the only tool that is not forwarded to the plugin is save_screenshots
        // If more are added we need to refactor to a better abstraction.
        if (rpcReq.tool === "save_screenshots") {
          const params = validatedParams ?? {};
          // Create a sender bound to the specific fileKey
          const sender = {
            sendWithParams: (
              requestType: string,
              nodeIds?: string[],
              sendParams?: Record<string, unknown>
            ) => this.bridge.sendWithParams(requestType, nodeIds, sendParams, fileKey),
          };
          const result = await executeSaveScreenshots(
            sender,
            params.items as Parameters<typeof executeSaveScreenshots>[1],
            params.format as ExportFormat | undefined,
            params.scale as number | undefined,
            params.clip as boolean | undefined
          );
          this.sendJSON(res, 200, { data: result });
          return;
        }

        const resp = await this.bridge.sendWithParams(
          rpcReq.tool,
          rpcReq.nodeIds,
          validatedParams,
          fileKey
        );

        this.sendJSON(res, 200, resp.error ? { error: resp.error } : { data: resp.data });
      } catch (err) {
        this.sendJSON(res, 200, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  private sendJSON(res: http.ServerResponse, status: number, body: RPCResponse): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  stop(): void {
    this.bridge.close();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
