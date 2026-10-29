import { INSTANCE_ID } from "./leader.js";
import type { Node } from "./node.js";
import { Role } from "./types.js";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

/**
 * Election handles leader detection and role transitions.
 *
 * On start it attempts to become leader (by binding the port).
 * If the port is taken and a healthy leader is found, it becomes a follower.
 * A periodic ticker monitors the leader and triggers takeover if it dies.
 *
 * When the leader URL points at another machine, that leader is preferred:
 * the node follows it whenever it is reachable, only binds the local port as
 * a fallback, and steps down again once the remote leader comes back.
 */
export class Election {
  private interval: ReturnType<typeof setInterval> | null = null;
  private leaderUrl: string;
  private remoteLeader: boolean;

  constructor(
    private port: number,
    private node: Node,
    leaderUrl: string
  ) {
    this.leaderUrl = leaderUrl;
    this.remoteLeader = !LOCAL_HOSTNAMES.has(new URL(leaderUrl).hostname);
  }

  async start(): Promise<void> {
    // Determine initial role
    await this.determineRole();

    // Continuous monitoring with random jitter (3-5 s)
    const jitter = 3_000 + Math.random() * 2_000;
    this.interval = setInterval(() => {
      this.checkAndUpdateRole().catch((err) => {
        console.error("Election check error:", err);
      });
    }, jitter);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async checkAndUpdateRole(): Promise<void> {
    switch (this.node.role) {
      case Role.Follower: {
        const alive = await this.pingLeader();
        if (!alive) {
          console.error("Leader not responding, attempting takeover...");
          try {
            await this.node.becomeLeader();
          } catch (err) {
            console.error("Failed to become leader:", err);
          }
        }
        break;
      }
      case Role.Leader:
        // A local fallback leader yields to the configured remote leader
        if (this.remoteLeader && (await this.pingLeader())) {
          console.error(`Remote leader ${this.leaderUrl} is reachable, stepping down`);
          this.node.becomeFollower();
        }
        break;
      case Role.Unknown:
        await this.determineRole();
        break;
    }
  }

  private async determineRole(): Promise<void> {
    // A reachable remote leader wins over binding the local port
    if (this.remoteLeader && (await this.pingLeader())) {
      this.node.becomeFollower();
      return;
    }

    // Try to become leader first
    try {
      await this.node.becomeLeader();
      return;
    } catch {
      // Port likely in use — check if there's a valid leader
    }

    if (await this.pingLeader()) {
      this.node.becomeFollower();
    }
    // If ping fails too, next tick will retry
  }

  /** True when a leader other than this process answers at the leader URL. */
  private async pingLeader(): Promise<boolean> {
    try {
      const response = await fetch(`${this.leaderUrl}/ping`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) return false;
      const body = (await response.json().catch(() => null)) as { instanceId?: string } | null;
      return body?.instanceId !== INSTANCE_ID;
    } catch {
      return false;
    }
  }
}
