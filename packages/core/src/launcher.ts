import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface LaunchedBrowser {
  port: number;
  close(): void;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function resolveChromiumBinary(): string {
  const fromEnv = process.env["UA_CHROMIUM"];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const prefix = process.env["PREFIX"] ?? "/data/data/com.termux/files/usr";
  const candidates = [
    join(prefix, "bin", "chromium-browser"),
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Arc.app/Contents/MacOS/Arc",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    join(process.env["HOME"] ?? "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    join(process.env["HOME"] ?? "", "Applications/Arc.app/Contents/MacOS/Arc"),
    join(process.env["HOME"] ?? "", "Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
    join(process.env["HOME"] ?? "", "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  for (const bin of ["chromium-browser", "chromium", "google-chrome", "google-chrome-stable"]) {
    try {
      const whiched = execFileSync("which", [bin], { encoding: "utf8" }).trim();
      if (whiched && existsSync(whiched)) return whiched;
    } catch {
      /* fall through */
    }
  }
  throw new Error(
    "No chromium binary found. Install it (pkg install chromium) or set UA_CHROMIUM.",
  );
}

export async function launchHeadless(
  opts: { extraArgs?: string[] } = {},
): Promise<LaunchedBrowser> {
  const bin = resolveChromiumBinary();
  const userDataDir = mkdtempSync(join(tmpdir(), "ua-chrome-"));
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--no-sandbox",
    `--user-data-dir=${userDataDir}`,
    ...(opts.extraArgs ?? []),
    "about:blank",
  ];
  const proc = spawn(bin, args, { stdio: "ignore" });
  const devtoolsFile = join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break;
    if (existsSync(devtoolsFile)) {
      try {
        const lines = readFileSync(devtoolsFile, "utf8").trim().split("\n");
        const port = parseInt(lines[0] ?? "", 10);
        if (Number.isFinite(port) && port > 0) {
          return {
            port,
            close: () => {
              try {
                proc.kill("SIGKILL");
              } catch {
                /* already dead */
              }
              try {
                rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
              } catch {
                /* ignore cleanup failure */
              }
            },
          };
        }
      } catch {
        /* retry until deadline */
      }
    }
    await delay(150);
  }
  try {
    proc.kill("SIGKILL");
  } catch {
    /* already dead */
  }
  try {
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch {
    /* ignore cleanup failure */
  }
  throw new Error("Chromium failed to start or expose DevToolsActivePort in time.");
}
