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
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    const whiched = execFileSync("which", ["chromium-browser"], { encoding: "utf8" }).trim();
    if (whiched) return whiched;
  } catch {
    /* fall through */
  }
  throw new Error(
    "No chromium binary found. Install it (pkg install chromium) or set UA_CHROMIUM.",
  );
}

export async function launchHeadless(): Promise<LaunchedBrowser> {
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
              rmSync(userDataDir, { recursive: true, force: true });
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
  rmSync(userDataDir, { recursive: true, force: true });
  throw new Error("Chromium failed to start or expose DevToolsActivePort in time.");
}
