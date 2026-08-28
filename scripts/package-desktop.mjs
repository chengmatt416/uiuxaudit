// Self-contained Electron packager — zero native deps (works on Termux/Android).
//
// Per target: download official electron zip → unzip → inject our app into
// resources/app → rename entry binary → (darwin) ad-hoc codesign every Mach-O
// with rcodesign (prebuilt, downloaded once) → archive.
//
// Usage: node scripts/package-desktop.mjs [platform:arch ...]
//   default: darwin:arm64 darwin:x64 win32:x64 linux:x64 linux:arm64
import { execFileSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "apps", "desktop");
const OUT = join(ROOT, "release");
const CACHE = join(ROOT, ".cache");
const TARGETS =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2).map((s) => s.split(":"))
    : [
        ["darwin", "arm64"],
        ["darwin", "x64"],
        ["win32", "x64"],
        ["linux", "x64"],
        ["linux", "arm64"],
      ];

const sh = (cmd, args, opts = {}) => {
  console.log("+", cmd, args.join(" "));
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
};

async function download(url, dest) {
  if (existsSync(dest)) {
    console.log("cached:", dest);
    return;
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      console.log(`GET (attempt ${attempt})`, url);
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(600_000) });
      if (!res.ok || !res.body) throw new Error(`${res.status} for ${url}`);
      await pipeline(res.body, createWriteStream(dest));
      return;
    } catch (err) {
      rmSync(dest, { force: true });
      if (attempt === 4) throw err;
      console.warn(`Download attempt ${attempt} failed: ${err}. Retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function githubJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "uiuxaudit-packager", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function ensureRcodesign() {
  if (process.platform === "darwin") return undefined;
  const bin = join(CACHE, "rcodesign");
  if (existsSync(bin)) return bin;
  const release = await githubJson(
    "https://api.github.com/repos/indygreg/apple-platform-rs/releases/latest",
  );
  const hostArch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const hostPlatform = process.platform === "linux" ? "unknown-linux-(musl|gnu)" : "apple-darwin";
  const regex = new RegExp(`apple-codesign-.*${hostArch}-${hostPlatform}\\.tar\\.gz$`);
  const asset = (release.assets ?? []).find((a) => regex.test(a.name));
  if (!asset) throw new Error(`no apple-codesign asset found for ${hostArch}-${hostPlatform}`);
  const tgz = join(CACHE, asset.name);
  await download(asset.browser_download_url, tgz);
  sh("tar", ["-xzf", tgz, "-C", CACHE]);
  // binary sits in a versioned directory inside the tarball
  const found = findFile(CACHE, "rcodesign");
  if (!found) throw new Error("rcodesign binary not found after extraction");
  sh("chmod", ["+x", found]);
  writeFileSync(bin, `#!/bin/sh\nexec "${found}" "$@"\n`);
  sh("chmod", ["+x", bin]);
  return bin;
}

function findFile(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    } else if (e.name === name) return p;
  }
  return undefined;
}

function injectApp(extractDir, platform) {
  const resources =
    platform === "darwin"
      ? join(extractDir, "Electron.app", "Contents", "Resources")
      : join(extractDir, "resources");
  const appDir = join(resources, "app");
  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(appDir, { recursive: true });
  for (const f of ["main.js", "preload.js", "package.json", "core-node.cjs"]) {
    execFileSync("cp", [join(ROOT, f), appDir]);
  }
  sh("cp", ["-r", join(ROOT, "web"), join(appDir, "web")]);
  if (platform !== "darwin") {
    rmSync(join(resources, "default_app.asar"), { force: true });
  }
}

function renameEntry(extractDir, platform) {
  if (platform === "darwin") {
    const app = join(extractDir, "Electron.app");
    const dst = join(extractDir, "uiuxaudit.app");
    rmSync(dst, { recursive: true, force: true });
    sh("mv", [app, dst]);
    const binDir = join(dst, "Contents", "MacOS");
    sh("mv", [join(binDir, "Electron"), join(binDir, "uiuxaudit")]);
    const helpers = join(dst, "Contents", "Frameworks");
    if (existsSync(helpers)) {
      // rename top-level helper app dirs' executables is unnecessary for adhoc;
      // keep helper names, they are signed recursively later.
    }
    const plist = join(dst, "Contents", "Info.plist");
    const xml = readFileSync(plist, "utf8");
    const patched = xml
      .replace(/(<key>CFBundleExecutable<\/key>\s*<string>)Electron(<\/string>)/, "$1uiuxaudit$2")
      .replace(/(<key>CFBundleName<\/key>\s*<string>)Electron(<\/string>)/, "$1uiuxaudit$2")
      .replace(
        /(<key>CFBundleDisplayName<\/key>\s*<string>)Electron(<\/string>)/,
        "$1uiuxaudit$2",
      )
      .replace(
        /(<key>CFBundleIdentifier<\/key>\s*<string>)com\.github\.Electron(<\/string>)/,
        "$1com.uiuxaudit.app$2",
      );
    writeFileSync(plist, patched);
    return dst;
  }
  const exe = platform === "win32" ? "electron.exe" : "electron";
  const p = join(extractDir, exe);
  if (existsSync(p)) {
    const next = platform === "win32" ? "uiuxaudit.exe" : "uiuxaudit";
    sh("mv", [p, join(extractDir, next)]);
  }
  return extractDir;
}

const electronVersion = execFileSync("npm", ["view", "electron", "version"])
  .toString()
  .trim();
console.log("electron version:", electronVersion);
mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });

const needMac = TARGETS.some(([p]) => p === "darwin");
const rcodesign = needMac ? await ensureRcodesign() : undefined;

for (const [platform, arch] of TARGETS) {
  const zipName = `electron-v${electronVersion}-${platform}-${arch}.zip`;
  const zipPath = join(CACHE, zipName);
  await download(
    `https://github.com/electron/electron/releases/download/v${electronVersion}/${zipName}`,
    zipPath,
  );
  const extractDir = join(OUT, `uiuxaudit-${platform}-${arch}`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  sh("unzip", ["-q", zipPath, "-d", extractDir]);
  injectApp(extractDir, platform);
  renameEntry(extractDir, platform);
  if (platform === "darwin") {
    const app = join(extractDir, "uiuxaudit.app");
    if (process.platform === "darwin") {
      sh("codesign", ["--force", "--deep", "-s", "-", app]);
      sh("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
      console.log("native adhoc signed & verified:", app);
    } else {
      sh(rcodesign, ["sign", app]);
      sh("find", [app, "-type", "f", "-perm", "-111", "-exec", rcodesign, "sign", "{}", ";"]);
      console.log("adhoc signed:", app);
    }
  }
  const base = extractDir.split("/").pop();
  if (platform === "darwin" || platform === "win32") {
    sh("zip", ["-qry", `${base}.zip`, base], { cwd: OUT });
  } else {
    sh("tar", ["-czf", `${base}.tar.gz`, base], { cwd: OUT });
  }
  console.log("packaged:", extractDir);
}
console.log("DESKTOP_PACKAGING_DONE");
