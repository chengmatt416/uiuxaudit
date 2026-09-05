/* uiuxaudit Figma plugin — plain JS, zero dependencies, zero network.
 * import: build a flat node tree from a capture JSON produced by the CLI.
 * apply:  mutate existing nodes (by name) from an ops JSON produced by `apply`.
 */

function solidFill(c) {
  return [
    {
      type: "SOLID",
      color: { r: c.r, g: c.g, b: c.b },
      opacity: c.a === undefined ? 1 : c.a,
    },
  ];
}

function styleForWeight(w) {
  if (w >= 700) return "Bold";
  if (w >= 600) return "Semi Bold";
  if (w >= 500) return "Medium";
  return "Regular";
}

function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function loadFontsFor(doc) {
  const needed = new Map();
  for (const n of doc.nodes) {
    if (n.kind !== "text") continue;
    const family = n.fontFamily || "Inter";
    const style = styleForWeight(n.fontWeight || 400);
    needed.set(family + "|" + style, { family: family, style: style });
  }
  const loaded = [];
  for (const entry of needed.values()) {
    try {
      await figma.loadFontAsync(entry);
      loaded.push(entry.family + "/" + entry.style);
    } catch (e1) {
      try {
        await figma.loadFontAsync({ family: "Inter", style: entry.style });
        entry.family = "Inter";
      } catch (e2) {
        try {
          await figma.loadFontAsync({ family: "Inter", style: "Regular" });
          entry.family = "Inter";
          entry.style = "Regular";
        } catch (e3) {
          /* leave; creation will fail for this node and be counted */
        }
      }
    }
  }
  return loaded.length;
}

function findRootFrame(slug) {
  return figma.currentPage.findOne(function (n) {
    return n.type === "FRAME" && n.name === "page:" + slug;
  });
}

async function runImport(doc) {
  const created = [];
  let failed = 0;
  const failures = [];

  await loadFontsFor(doc);

  const root = figma.createFrame();
  root.name = "page:" + doc.slug;
  root.x = 0;
  root.y = 0;
  root.resize(Math.max(doc.docWidth, 1), Math.max(doc.docHeight, 1));
  root.clipsContent = false;
  root.fills = doc.rootBg ? solidFill(doc.rootBg) : [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  figma.currentPage.appendChild(root);

  const nodes = doc.nodes.slice().sort(function (a, b) { return a.order - b.order; });

  for (const n of nodes) {
    try {
      let node;
      if (n.kind === "text") {
        node = figma.createText();
        const family = n.fontFamily || "Inter";
        let style = styleForWeight(n.fontWeight || 400);
        let useFamily = family;
        try {
          await figma.loadFontAsync({ family: useFamily, style: style });
        } catch (e1) {
          useFamily = "Inter";
          try {
            await figma.loadFontAsync({ family: useFamily, style: style });
          } catch (e2) {
            style = "Regular";
            await figma.loadFontAsync({ family: useFamily, style: style });
          }
        }
        node.fontName = { family: useFamily, style: style };
        node.characters = n.text || "";
        node.fontSize = Math.max(n.fontSize || 16, 1);
        node.fills = n.textColor ? solidFill(n.textColor) : solidFill({ r: 0, g: 0, b: 0 });
        node.textAlignHorizontal = n.textAlign || "LEFT";
        if (n.lineHeight != null) node.lineHeight = { value: n.lineHeight, unit: "PIXELS" };
        if (n.letterSpacing != null) node.letterSpacing = { value: n.letterSpacing, unit: "PIXELS" };
        root.appendChild(node);
        node.textAutoResize = "NONE";
        node.resize(Math.max(n.w, 1), Math.max(n.h, 1));
        node.x = n.x;
        node.y = n.y;
        node.opacity = n.opacity === undefined ? 1 : n.opacity;
      } else if (n.kind === "image") {
        node = figma.createRectangle();
        root.appendChild(node);
        node.x = n.x;
        node.y = n.y;
        node.resize(Math.max(n.w, 1), Math.max(n.h, 1));
        if (n.imageDataUrl) {
          try {
            const hash = figma.createImage(dataUrlToBytes(n.imageDataUrl)).hash;
            node.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: hash }];
          } catch (e) {
            node.fills = solidFill({ r: 0.85, g: 0.85, b: 0.85, a: 1 });
          }
        } else {
          node.fills = solidFill({ r: 0.85, g: 0.85, b: 0.85, a: 1 });
        }
        if (n.radii) {
          node.topLeftRadius = n.radii[0];
          node.topRightRadius = n.radii[1];
          node.bottomRightRadius = n.radii[2];
          node.bottomLeftRadius = n.radii[3];
        }
        node.opacity = n.opacity === undefined ? 1 : n.opacity;
      } else {
        // frame | vector → rectangle carrying geometry + paint
        node = figma.createRectangle();
        root.appendChild(node);
        node.x = n.x;
        node.y = n.y;
        node.resize(Math.max(n.w, 1), Math.max(n.h, 1));
        node.fills = n.bgColor ? solidFill(n.bgColor) : [];
        if (n.border && n.border.width > 0) {
          node.strokes = solidFill(n.border.color);
          node.strokeWeight = n.border.width;
          node.strokeAlign = "INSIDE";
        }
        if (n.radii) {
          node.topLeftRadius = n.radii[0];
          node.topRightRadius = n.radii[1];
          node.bottomRightRadius = n.radii[2];
          node.bottomLeftRadius = n.radii[3];
        }
        node.opacity = n.opacity === undefined ? 1 : n.opacity;
      }
      node.name = n.id;
      created.push(node.id);
    } catch (err) {
      failed++;
      if (failures.length < 10) failures.push(n.id + ": " + err);
    }
  }

  figma.viewport.scrollAndZoomIntoView([root]);
  figma.ui.postMessage({
    type: "done",
    created: created.length,
    failed: failed,
    detail: failures.join("\n"),
  });
}

async function runApply(payload) {
  const slug = payload.slug;
  const ops = payload.ops || [];
  const root = findRootFrame(slug);
  if (!root) {
    figma.ui.postMessage({
      type: "error",
      message: 'No frame named "page:' + slug + '" on current page. Import it first.',
    });
    return;
  }
  const byName = {};
  for (const child of root.children) byName[child.name] = child;

  let applied = 0;
  let skipped = 0;
  const notes = [];

  for (const op of ops) {
    const node = byName[op.id];
    if (!node) {
      skipped++;
      if (notes.length < 10) notes.push("missing node " + op.id);
      continue;
    }
    try {
      switch (op.op) {
        case "setFill":
        case "setBackground":
          node.fills = solidFill(op.value);
          break;
        case "setFontSize":
          await figma.loadFontAsync(node.fontName);
          node.fontSize = op.value;
          break;
        case "setSize":
          node.resize(Math.max(op.w, 1), Math.max(op.h, 1));
          break;
        case "setSnapY":
          node.y = op.value;
          break;
        default:
          skipped++;
          if (notes.length < 10) notes.push("unknown op " + op.op);
          continue;
      }
      applied++;
    } catch (err) {
      skipped++;
      if (notes.length < 10) notes.push(op.id + "/" + op.op + ": " + err);
    }
  }

  figma.ui.postMessage({
    type: "applied",
    applied: applied,
    skipped: skipped,
    detail: notes.join("\n"),
  });
}

async function runCreateStyles(payload) {
  if (typeof figma.createPaintStyle !== "function") {
    figma.ui.postMessage({ type: "error", message: "createPaintStyle not supported in this environment" });
    return;
  }
  const slug = payload.slug || "tokens";
  const nodes = payload.nodes || [];
  const colorMap = new Map();
  for (const n of nodes) {
    if (n.bgColor && n.bgColor.a > 0.05) {
      const k = Math.round(n.bgColor.r * 255) + "," + Math.round(n.bgColor.g * 255) + "," + Math.round(n.bgColor.b * 255);
      colorMap.set(k, n.bgColor);
    }
    if (n.textColor && n.textColor.a > 0.05) {
      const k = Math.round(n.textColor.r * 255) + "," + Math.round(n.textColor.g * 255) + "," + Math.round(n.textColor.b * 255);
      colorMap.set(k, n.textColor);
    }
  }
  let count = 0;
  let idx = 1;
  for (const c of colorMap.values()) {
    try {
      const style = figma.createPaintStyle();
      style.name = slug + "/color-" + (idx++);
      style.paints = solidFill(c);
      count++;
    } catch (e) {
      /* skip unsupported style creation */
    }
  }
  figma.ui.postMessage({ type: "stylesCreated", count: count });
}

figma.showUI(__html__, { width: 440, height: 520 });
figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === "import") await runImport(msg.payload);
    else if (msg.type === "apply") await runApply(msg.payload);
    else if (msg.type === "createStyles") await runCreateStyles(msg.payload);
  } catch (err) {
    figma.ui.postMessage({ type: "error", message: String(err) });
  }
};

