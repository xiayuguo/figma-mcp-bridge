import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Bridge } from "./bridge.js";

const exec = promisify(execFile);

const PLUGIN_NAME = process.env.FIGMA_BRIDGE_PLUGIN_NAME || "Figma MCP Bridge";
const LAUNCH_ATTEMPTS = 2;
/** A plugin already running in the file reconnects on its own (e.g. after a leader restart). */
const RECONNECT_GRACE_MS = 3_000;
const CONNECT_TIMEOUT_MS = 25_000;
const LAUNCH_SCRIPT_TIMEOUT_MS = 45_000;
const NODE_ID_PATTERN = /^(\d+:\d+|I\d+:\d+(;\d+:\d+)+)$/;
const PERMISSION_ERROR_PATTERN = /not allowed|assistive access|-1719|-25211|\b1002\b/i;

/**
 * Launches the development plugin in the frontmost Figma tab. The menu item is
 * preferred because its enabled state tells us the file has finished loading;
 * when the English menu path is missing (localised UI, renamed menus) it falls
 * back to Quick Actions, typed in lowercase so a missed palette only switches
 * canvas tools instead of editing the file.
 */
const LAUNCH_SCRIPT = `
on run argv
  set pluginName to item 1 of argv
  tell application "Figma" to activate
  delay 1
  set missCount to 0
  tell application "System Events"
    tell process "Figma"
      repeat 30 times
        try
          set pluginItem to menu item pluginName of menu 1 of menu item "Development" of menu 1 of menu bar item "Plugins" of menu bar 1
          if enabled of pluginItem then
            click pluginItem
            return "menu"
          end if
        on error
          set missCount to missCount + 1
          if missCount >= 5 then exit repeat
        end try
        delay 1
      end repeat
      set frontmost to true
      key code 44 using command down
      delay 1
      keystroke item 2 of argv
      delay 1.5
      key code 36
    end tell
  end tell
  return "quick-actions"
end run`;

export interface FigmaUrlTarget {
  url: string;
  fileKey: string;
  /** node-id from the link, converted to the plugin's colon format. */
  nodeId?: string;
}

export interface OpenFigmaResult extends FigmaUrlTarget {
  fileName: string;
  status: "already_connected" | "connected";
}

/** Parses a Figma design/file link into the fileKey (branch key for branches) and node ID it targets. */
export function parseFigmaUrl(input: unknown): FigmaUrlTarget {
  if (typeof input !== "string") throw new Error("url is required");
  const url = new URL(input);
  const match = /^\/(?:file|design)\/([a-zA-Z0-9]+)(?:\/branch\/([a-zA-Z0-9]+))?(?:\/|$)/.exec(
    url.pathname
  );
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "www.figma.com" && url.hostname !== "figma.com") ||
    url.username ||
    url.password ||
    url.port ||
    !match
  ) {
    throw new Error("Expected an HTTPS Figma design/file URL on www.figma.com");
  }

  const nodeId = url.searchParams.get("node-id")?.replace(/-/g, ":");
  return {
    url: url.href,
    fileKey: match[2] ?? match[1],
    nodeId: nodeId && NODE_ID_PATTERN.test(nodeId) ? nodeId : undefined,
  };
}

const inFlight = new Map<string, Promise<OpenFigmaResult>>();
let uiQueue: Promise<unknown> = Promise.resolve();

/**
 * Makes sure the linked file is connected to the bridge, opening it on the
 * leader host and launching the plugin when it is not. Resolves only once the
 * plugin for that fileKey has connected; concurrent calls for the same file
 * share one launch, and launches for different files run one at a time since
 * they drive the same Figma window.
 */
export function openFigmaUrl(input: unknown, bridge: Bridge): Promise<OpenFigmaResult> {
  const target = parseFigmaUrl(input);
  const connected = bridge.getConnectedFile(target.fileKey);
  if (connected) {
    return Promise.resolve({
      ...target,
      fileName: connected.fileName,
      status: "already_connected",
    });
  }

  let pending = inFlight.get(target.fileKey);
  if (!pending) {
    pending = uiQueue
      .then(() => openAndConnect(target, bridge))
      .finally(() => inFlight.delete(target.fileKey));
    uiQueue = pending.catch(() => undefined);
    inFlight.set(target.fileKey, pending);
  }
  return pending;
}

async function openAndConnect(target: FigmaUrlTarget, bridge: Bridge): Promise<OpenFigmaResult> {
  // An earlier queued launch may have connected this file meanwhile
  let file = bridge.getConnectedFile(target.fileKey);
  if (file) return { ...target, fileName: file.fileName, status: "already_connected" };

  if (process.platform !== "darwin")
    throw new Error("The leader must run on macOS to open Figma files");

  let lastError = "";
  for (let attempt = 1; attempt <= LAUNCH_ATTEMPTS; attempt++) {
    // Re-open on every attempt so the target tab is the frontmost one
    await exec("open", ["-a", "Figma", target.url]);
    if (attempt === 1) {
      file = await bridge.waitForFile(target.fileKey, RECONNECT_GRACE_MS);
      if (file) break;
    }

    try {
      const { stdout } = await exec(
        "osascript",
        ["-e", LAUNCH_SCRIPT, PLUGIN_NAME, PLUGIN_NAME.toLowerCase()],
        {
          timeout: LAUNCH_SCRIPT_TIMEOUT_MS,
        }
      );
      console.error(
        `Launched ${PLUGIN_NAME} via ${stdout.trim()} for ${target.fileKey} (attempt ${attempt})`
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (PERMISSION_ERROR_PATTERN.test(lastError)) {
        throw new Error(
          `Could not drive Figma: grant Accessibility permission to the process running the server (System Settings → Privacy & Security → Accessibility). ${lastError}`
        );
      }
      console.error(`Plugin launch attempt ${attempt} failed: ${lastError}`);
    }

    file = await bridge.waitForFile(target.fileKey, CONNECT_TIMEOUT_MS);
    if (file) break;
  }

  if (!file) {
    const connected = bridge.listConnectedFiles();
    throw new Error(
      `Opened ${target.url} but the plugin for fileKey "${target.fileKey}" did not connect after ${LAUNCH_ATTEMPTS} launch attempts.` +
        (lastError ? ` Last launch error: ${lastError}.` : "") +
        ` Check that the "${PLUGIN_NAME}" development plugin is imported on the leader Mac and that the desktop session is unlocked.` +
        (connected.length > 0
          ? ` Connected files: ${connected.map((f) => `"${f.fileName}" (fileKey: ${f.fileKey})`).join(", ")}.`
          : "")
    );
  }
  return { ...target, fileName: file.fileName, status: "connected" };
}
