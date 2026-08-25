import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { captureUrl } from "../packages/core/src/index.js";

const url = process.argv[2] ?? "https://example.com";
const slug = process.argv[3] ?? "smoke";

mkdirSync(".uiuxaudit/out", { recursive: true });
const t0 = Date.now();
const doc = await captureUrl(url, { slug });
const out = `.uiuxaudit/out/${slug}.capture.json`;
writeFileSync(out, JSON.stringify(doc));

const counts = {
  frame: 0,
  text: 0,
  image: 0,
  vector: 0,
};
for (const n of doc.nodes) counts[n.kind]++;
console.log(
  JSON.stringify(
    {
      slug,
      url: doc.url,
      title: doc.title,
      docSize: `${doc.docWidth}x${doc.docHeight}`,
      nodes: doc.nodes.length,
      byKind: counts,
      bytesOnDisk: statSync(out).size,
      elapsedMs: Date.now() - t0,
    },
    null,
    2,
  ),
);
