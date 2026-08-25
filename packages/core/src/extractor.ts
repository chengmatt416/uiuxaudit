/**
 * In-page extraction function. MUST stay self-contained: no imports, no
 * references to module scope. It is transpiled with esbuild at runtime and
 * evaluated inside the target page via CDP Runtime.evaluate.
 *
 * Extracts every visible painted element plus its text runs as flat,
 * absolutely-positioned nodes. Deterministic: ids follow document order.
 */
function __ua_extract(withProvenance: boolean) {
  const PX = (v: string | null | undefined): number => {
    const n = parseFloat(v || "");
    return Number.isFinite(n) ? n : 0;
  };

  function parseColor(
    str: string | null | undefined,
  ): { r: number; g: number; b: number; a: number } | null {
    if (!str) return null;
    let m = str.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (parts.length >= 3) {
        return {
          r: parts[0] / 255,
          g: parts[1] / 255,
          b: parts[2] / 255,
          a: parts.length > 3 ? parts[3] : 1,
        };
      }
      return null;
    }
    m = str.match(/color\(\s*srgb\s+([^)]+)\)/i);
    if (m) {
      const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      if (parts.length >= 3) {
        return {
          r: parts[0],
          g: parts[1],
          b: parts[2],
          a: parts.length > 3 ? parts[3] : 1,
        };
      }
    }
    return null;
  }

  function parseLen(v: string, ref: number): number {
    if (!v) return 0;
    const pct = v.match(/^([\d.]+)%$/);
    if (pct) return (parseFloat(pct[1]) / 100) * ref;
    return PX(v);
  }

  function radiusCorner(v: string, w: number, h: number): number {
    const first = (v || "0").split("/")[0].trim().split(/\s+/)[0];
    return parseLen(first, Math.min(w, h));
  }

  const SKIP_TAGS: Record<string, true> = {
    SCRIPT: true,
    STYLE: true,
    NOSCRIPT: true,
    TEMPLATE: true,
    LINK: true,
    META: true,
    TITLE: true,
    HEAD: true,
    BASE: true,
    BR: true,
    WBR: true,
    SOURCE: true,
    TRACK: true,
    PARAM: true,
    SLOT: true,
  };
  const MEDIA_TAGS: Record<string, true> = {
    IMG: true,
    VIDEO: true,
    CANVAS: true,
    PICTURE: true,
  };
  const INTERACTIVE_TAGS: Record<string, true> = {
    A: true,
    BUTTON: true,
    INPUT: true,
    SELECT: true,
    TEXTAREA: true,
    SUMMARY: true,
  };
  const ALIGN_MAP: Record<string, string> = {
    start: "LEFT",
    left: "LEFT",
    end: "RIGHT",
    right: "RIGHT",
    center: "CENTER",
    justify: "JUSTIFIED",
  };
  const WANTED_PROPS = [
    "color", "background-color", "font-size", "line-height", "letter-spacing",
    "width", "height", "min-width", "min-height", "margin",
    "padding-top", "padding-bottom", "border-radius", "opacity",
  ];

  // ---- provenance machinery (source mode only) ----
  let flatRules: Array<{
    sel: string;
    rule: CSSStyleRule;
    spec: number;
    order: number;
    href: string;
  }> = [];

  function specificity(sel: string): number {
    const ids = (sel.match(/#[\w-]+/g) || []).length;
    const classes = (sel.match(/\.[\w-]+|\[[^\]]+\]|::?[a-z-]+/g) || []).length;
    const tags = (sel.match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) || []).length;
    return ids * 10000 + classes * 100 + tags;
  }

  function buildFlatRules(): void {
    flatRules = [];
    let order = 0;
    const visit = (rules: ArrayLike<CSSRule>, href: string): void => {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i] as CSSRule & {
          cssRules?: ArrayLike<CSSRule>;
          selectorText?: string;
        };
        if (rule.cssRules && rule.selectorText === undefined) {
          visit(rule.cssRules, href);
          continue;
        }
        const styleRule = rule as CSSStyleRule;
        if (styleRule.selectorText && styleRule.style) {
          flatRules.push({
            sel: styleRule.selectorText,
            rule: styleRule,
            spec: specificity(styleRule.selectorText),
            order: order++,
            href,
          });
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const href = sheet.href || document.location.href + "#inline-style";
        visit(sheet.cssRules, href);
      } catch {
        // cross-origin stylesheet without CORS: unreadable, skip
      }
    }
  }

  function matchedDecls(
    el: Element,
  ):
    | { cssHref: string; selector: string; decls: Record<string, string>; inline: Record<string, string> }
    | undefined {
    const best: Record<
      string,
      { spec: number; order: number; sel: string; href: string; val: string }
    > = {};
    for (const fr of flatRules) {
      let ok = false;
      try {
        ok = el.matches(fr.sel);
      } catch {
        ok = false;
      }
      if (!ok) continue;
      for (const p of WANTED_PROPS) {
        const v = fr.rule.style.getPropertyValue(p);
        if (!v) continue;
        const cur = best[p];
        if (!cur || fr.spec > cur.spec || (fr.spec === cur.spec && fr.order >= cur.order)) {
          best[p] = { spec: fr.spec, order: fr.order, sel: fr.sel, href: fr.href, val: v };
        }
      }
    }
    const inline: Record<string, string> = {};
    const styleAttr = (el as HTMLElement).style;
    if (styleAttr && styleAttr.length) {
      for (const p of WANTED_PROPS) {
        const v = styleAttr.getPropertyValue(p);
        if (v) inline[p] = v;
      }
    }
    const props = Object.keys(best);
    if (!props.length && !Object.keys(inline).length) return undefined;
    let rep = { spec: -1, order: -1, sel: "*", href: "" };
    for (const p of props) {
      const b = best[p];
      if (b.spec > rep.spec || (b.spec === rep.spec && b.order > rep.order)) {
        rep = { spec: b.spec, order: b.order, sel: b.sel, href: b.href };
      }
    }
    const decls: Record<string, string> = {};
    for (const p of props) decls[p] = best[p].val;
    return {
      cssHref: rep.href || document.location.href + "#unknown",
      selector: rep.sel,
      decls,
      inline,
    };
  }

  // ---- visibility & paint predicates ----
  function visible(el: Element): boolean {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity || "1") === 0) return false;
    return true;
  }

  function directText(el: Element): string {
    let s = "";
    for (const n of Array.prototype.slice.call(el.childNodes)) {
      if (n.nodeType === 3) s += n.textContent || "";
    }
    return s;
  }

  const htmlEl = document.documentElement;
  const htmlBg = parseColor(getComputedStyle(htmlEl).backgroundColor);
  const bodyBg = document.body
    ? parseColor(getComputedStyle(document.body).backgroundColor)
    : null;
  const rootBg =
    htmlBg && htmlBg.a > 0 ? htmlBg : bodyBg && bodyBg.a > 0 ? bodyBg : undefined;

  const effBgCache = new Map<Element, { r: number; g: number; b: number; a: number } | null>();
  function effectiveBg(
    start: Element,
  ): { r: number; g: number; b: number; a: number } | undefined {
    if (effBgCache.has(start)) return effBgCache.get(start) || undefined;
    let p: Element | null = start;
    while (p) {
      const bg = parseColor(getComputedStyle(p).backgroundColor);
      if (bg && bg.a > 0) {
        effBgCache.set(start, bg);
        return bg;
      }
      p = p.parentElement;
    }
    effBgCache.set(start, rootBg || null);
    return rootBg;
  }

  function opacityProduct(start: Element): number {
    let o = 1;
    let p: Element | null = start;
    while (p) {
      o *= parseFloat(getComputedStyle(p).opacity || "1");
      if (o === 0) break;
      p = p.parentElement;
    }
    return Math.round(o * 1000) / 1000;
  }

  // ---- pass 1: candidates ----
  const all = Array.prototype.slice.call(document.querySelectorAll("*")) as Element[];
  const cands: Array<{ el: Element; r: DOMRect; cs: CSSStyleDeclaration }> = [];
  for (const el of all) {
    const tag = el.tagName;
    if (SKIP_TAGS[tag]) continue;
    if (tag === "INPUT" && (el as HTMLInputElement).type === "hidden") continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    const bg = parseColor(cs.backgroundColor);
    const bw = Math.max(
      PX(cs.borderTopWidth), PX(cs.borderRightWidth),
      PX(cs.borderBottomWidth), PX(cs.borderLeftWidth),
    );
    const bc = parseColor(cs.borderTopColor);
    const isMedia = !!MEDIA_TAGS[tag] || tag === "SVG" || tag === "IFRAME";
    const isForm =
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON";
    const hasText = directText(el).trim().length > 0;
    const hasBgImage = cs.backgroundImage && cs.backgroundImage !== "none";
    const paints =
      (!!bg && bg.a > 0) ||
      (bw > 0 && !!bc && bc.a > 0) ||
      isMedia || isForm || hasText || !!hasBgImage;
    if (!paints) continue;
    cands.push({ el, r, cs });
  }

  const PROVENANCE_ELEMENT_LIMIT = 6000;
  const withProv = withProvenance && cands.length <= PROVENANCE_ELEMENT_LIMIT;
  if (withProv) buildFlatRules();

  // ---- pass 2: emit nodes ----
  const nodes: Array<Record<string, unknown>> = [];
  const imageUrls: string[] = [];
  const seenImages = new Set<string>();
  let orderCounter = 0;
  let nextTextId = cands.length;
  const parentOf = new Map<Element, string>();

  function emit(n: Record<string, unknown>): void {
    n["order"] = orderCounter++;
    nodes.push(n);
  }

  for (let idx = 0; idx < cands.length; idx++) {
    const c = cands[idx];
    const id = "e" + (idx + 1);
    const el = c.el;
    const r = c.r;
    const cs = c.cs;
    const tag = el.tagName;

    let nearest: Element | null = el.parentElement;
    let parent: string | null = null;
    while (nearest) {
      const pid = parentOf.get(nearest);
      if (pid !== undefined) {
        parent = pid;
        break;
      }
      nearest = nearest.parentElement;
    }

    const bg = parseColor(cs.backgroundColor);
    const bw = Math.max(
      PX(cs.borderTopWidth), PX(cs.borderRightWidth),
      PX(cs.borderBottomWidth), PX(cs.borderLeftWidth),
    );
    const bc = parseColor(cs.borderTopColor);

    const base: Record<string, unknown> = {
      id,
      tag,
      kind: "frame",
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      w: r.width,
      h: r.height,
      parent,
      effectiveBg: effectiveBg(el),
      opacity: opacityProduct(el),
      radii: [
        radiusCorner(cs.borderTopLeftRadius, r.width, r.height),
        radiusCorner(cs.borderTopRightRadius, r.width, r.height),
        radiusCorner(cs.borderBottomRightRadius, r.width, r.height),
        radiusCorner(cs.borderBottomLeftRadius, r.width, r.height),
      ],
      interactive:
        !!INTERACTIVE_TAGS[tag] ||
        el.getAttribute("role") === "button" ||
        el.getAttribute("role") === "link" ||
        el.getAttribute("role") === "tab",
    };
    parentOf.set(el, id);

    if (tag === "SVG") {
      base.kind = "vector";
      emit(base);
      continue;
    }
    if (MEDIA_TAGS[tag]) {
      base.kind = "image";
      if (tag === "IMG") {
        const img = el as HTMLImageElement;
        const src = img.currentSrc || img.src;
        if (src && !seenImages.has(src)) {
          seenImages.add(src);
          imageUrls.push(src);
        }
        base.imageUrl = src || undefined;
      }
      emit(base);
      continue;
    }

    base.kind = "frame";
    if (bg && bg.a > 0) base.bgColor = bg;
    if (bw > 0 && bc && bc.a > 0) base.border = { width: bw, color: bc };
    if (tag === "A") base.href = (el as HTMLAnchorElement).href;
    if (withProv) {
      const prov = matchedDecls(el);
      if (prov) base.provenance = prov;
    }
    emit(base);

    // Synthetic form-control text (value / placeholder / selected option)
    if (tag === "INPUT" || tag === "SELECT") {
      const inp = el as HTMLInputElement;
      let label = "";
      if (
        tag === "INPUT" &&
        ["checkbox", "radio", "range", "file"].indexOf(inp.type) === -1
      ) {
        label = inp.value || inp.placeholder || "";
      } else if (tag === "SELECT") {
        const sel = el as HTMLSelectElement;
        const opt = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
        label = opt ? opt.textContent || "" : "";
      }
      if (label.trim()) {
        const fs = PX(cs.fontSize) || 16;
        const pl = PX(cs.paddingLeft) + PX(cs.borderLeftWidth);
        emit({
          id: "e" + ++nextTextId,
          kind: "text",
          tag: "#form-text",
          x: r.left + pl,
          y: r.top + (r.height - fs * 1.2) / 2,
          w: Math.max(r.width - pl - PX(cs.paddingRight) - PX(cs.borderRightWidth), 1),
          h: fs * 1.3,
          text: label.replace(/\s+/g, " "),
          textColor: parseColor(cs.color) || { r: 0, g: 0, b: 0, a: 1 },
          effectiveBg: effectiveBg(el),
          fontSize: fs,
          fontWeight: parseInt(cs.fontWeight, 10) || 400,
          fontFamily: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
          lineHeight: null,
          letterSpacing: cs.letterSpacing === "normal" ? null : PX(cs.letterSpacing),
          textAlign: "LEFT",
          opacity: opacityProduct(el),
          provenance: withProv ? matchedDecls(el) : undefined,
        });
      }
    }

    // Real text runs (direct text children), measured per rendered rect union
    for (const tn of Array.prototype.slice.call(el.childNodes)) {
      if (tn.nodeType !== 3) continue;
      const textContent = tn.textContent || "";
      if (!textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(tn);
      const rects = Array.prototype.slice.call(range.getClientRects()).filter(
        (rr: DOMRect) => rr.width >= 1 && rr.height >= 1,
      ) as DOMRect[];
      if (!rects.length) continue;
      let uL = Infinity;
      let uT = Infinity;
      let uR = -Infinity;
      let uB = -Infinity;
      for (const rr of rects) {
        uL = Math.min(uL, rr.left);
        uT = Math.min(uT, rr.top);
        uR = Math.max(uR, rr.right);
        uB = Math.max(uB, rr.bottom);
      }
      const fs = PX(cs.fontSize) || 16;
      const lhRaw = cs.lineHeight;
      const lineHeight = lhRaw === "normal" ? null : PX(lhRaw);
      emit({
        id: "e" + ++nextTextId,
        kind: "text",
        tag: "#text",
        x: uL + window.scrollX,
        y: uT + window.scrollY,
        w: uR - uL,
        h: uB - uT,
        text: textContent.replace(/\s+/g, " "),
        textColor: parseColor(cs.color) || { r: 0, g: 0, b: 0, a: 1 },
        effectiveBg: effectiveBg(el),
        fontSize: fs,
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
        fontFamily: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
        lineHeight,
        letterSpacing: cs.letterSpacing === "normal" ? null : PX(cs.letterSpacing),
        textAlign: ALIGN_MAP[cs.textAlign] || "LEFT",
        opacity: opacityProduct(el),
        provenance: withProv ? matchedDecls(el) : undefined,
      });
    }
  }

  return {
    title: document.title,
    docWidth: Math.max(
      htmlEl.scrollWidth,
      document.body ? document.body.scrollWidth : 0,
      window.innerWidth,
    ),
    docHeight: Math.max(
      htmlEl.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
      window.innerHeight,
    ),
    rootBg: rootBg || null,
    nodes,
    imageUrls,
  };
}

export default __ua_extract;
