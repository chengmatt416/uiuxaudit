import { mkdirSync, writeFileSync } from "node:fs";
import { launchHeadless } from "../packages/core/src/launcher.js";
import { Cdp } from "../packages/core/src/cdp.js";

/** Renders the app icon at a given size with headless Chromium. */
async function makeIcon(cdp: Cdp, size: number, out: string): Promise<void> {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: size,
    height: size,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const html =
    `<body style="margin:0"><div style="width:${size}px;height:${size}px;` +
    `display:grid;place-content:center;background:#0e1116;` +
    `font:700 ${Math.round(size * 0.16)}px ui-sans-serif,system-ui;color:#4da3ff;` +
    `letter-spacing:1px">uiux<span style="color:#d7dde5">audit</span></div></body>`;
  await cdp.send("Page.navigate", {
    url: "data:text/html;charset=utf-8," + encodeURIComponent(html),
  });
  await new Promise((r) => setTimeout(r, 250));
  const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
  });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("icon →", out);
}

mkdirSync("apps/web/dist", { recursive: true });
const browser = await launchHeadless();
let cdp: Cdp | undefined;
try {
  const res = await fetch(
    `http://127.0.0.1:${browser.port}/json/new?` + encodeURIComponent("about:blank"),
    { method: "PUT" },
  );
  const target = (await res.json()) as { webSocketDebuggerUrl: string };
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await makeIcon(cdp, 512, "apps/web/dist/icon-512.png");
  await makeIcon(cdp, 192, "apps/web/dist/icon-192.png");
} finally {
  cdp?.close();
  browser.close();
}
