import type { CaptureDoc, ColorToken, DesignTokens, RGBA } from "./types.js";

function rgbaToHex(c: RGBA): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return c.a < 0.999 ? `${base}${h(c.a)}` : base;
}

function luminance(c: RGBA): number {
  const f = (u: number) => (u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/**
 * Extracts design tokens (colors, typography, spacing, radii) from a CaptureDoc.
 */
export function extractTokens(doc: CaptureDoc): DesignTokens {
  const colorMap = new Map<string, { rgba: RGBA; count: number; roles: Set<ColorToken["role"]> }>();

  const registerColor = (c: RGBA | undefined, role: ColorToken["role"]) => {
    if (!c || c.a <= 0.01) return;
    const hex = rgbaToHex(c);
    const existing = colorMap.get(hex);
    if (existing) {
      existing.count++;
      existing.roles.add(role);
    } else {
      colorMap.set(hex, { rgba: { ...c }, count: 1, roles: new Set([role]) });
    }
  };

  if (doc.rootBg) registerColor(doc.rootBg, "background");

  const fontFamilies = new Set<string>();
  const fontSizes = new Set<number>();
  const fontWeights = new Set<number>();
  const lineHeights = new Set<number>();
  const spacings = new Set<number>();
  const radiiSet = new Set<number>();

  for (const n of doc.nodes) {
    if (n.bgColor) registerColor(n.bgColor, "surface");
    if (n.textColor) registerColor(n.textColor, "text");
    if (n.border?.color) registerColor(n.border.color, "border");

    if (n.kind === "text") {
      if (n.fontFamily) fontFamilies.add(n.fontFamily);
      if (n.fontSize && n.fontSize > 0) fontSizes.add(Math.round(n.fontSize * 10) / 10);
      if (n.fontWeight) fontWeights.add(n.fontWeight);
      if (n.lineHeight && n.lineHeight > 0) lineHeights.add(Math.round(n.lineHeight * 10) / 10);
    }

    if (n.radii) {
      for (const r of n.radii) {
        if (r > 0) radiiSet.add(Math.round(r));
      }
    }

    if (n.w > 0 && n.w <= 128 && n.w % 4 === 0) spacings.add(n.w);
    if (n.h > 0 && n.h <= 128 && n.h % 4 === 0) spacings.add(n.h);
  }

  const sortedColors = [...colorMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 24);

  const colors: ColorToken[] = sortedColors.map(([hex, data], idx) => {
    let role: ColorToken["role"] = "surface";
    if (data.roles.has("text")) role = "text";
    else if (data.roles.has("border")) role = "border";
    else if (data.roles.has("background")) role = "background";

    const lum = luminance(data.rgba);
    let name = `color-${idx + 1}`;
    if (role === "text") name = lum < 0.2 ? "color-text-primary" : "color-text-secondary";
    else if (role === "background") name = lum > 0.8 ? "color-bg-light" : "color-bg-dark";
    else if (role === "border") name = `color-border-${idx}`;
    else if (idx === 0) name = "color-primary";

    return {
      name,
      hex,
      rgba: data.rgba,
      role,
      count: data.count,
    };
  });

  const commonSpacings = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64].filter((s) => spacings.has(s));

  return {
    colors,
    typography: {
      fontFamilies: [...fontFamilies].sort(),
      fontSizeScale: [...fontSizes].sort((a, b) => a - b),
      fontWeights: [...fontWeights].sort((a, b) => a - b),
      lineHeights: [...lineHeights].sort((a, b) => a - b),
    },
    spacing: commonSpacings.length > 0 ? commonSpacings : [4, 8, 16, 24, 32],
    radii: [...radiiSet].sort((a, b) => a - b),
  };
}

/**
 * Serializes design tokens to CSS custom properties.
 */
export function tokensToCss(tokens: DesignTokens): string {
  const lines: string[] = [":root {", "  /* Colors */"];

  tokens.colors.forEach((c) => {
    lines.push(`  --${c.name}: ${c.hex}; /* usage: ${c.count} */`);
  });

  lines.push("", "  /* Typography */");
  if (tokens.typography.fontFamilies.length) {
    lines.push(`  --font-family-base: ${tokens.typography.fontFamilies.join(", ")};`);
  }
  tokens.typography.fontSizeScale.forEach((fs, i) => {
    lines.push(`  --font-size-${i + 1}: ${fs}px;`);
  });

  lines.push("", "  /* Spacing */");
  tokens.spacing.forEach((s, i) => {
    lines.push(`  --space-${i + 1}: ${s}px;`);
  });

  if (tokens.radii.length) {
    lines.push("", "  /* Border Radii */");
    tokens.radii.forEach((r, i) => {
      lines.push(`  --radius-${i + 1}: ${r}px;`);
    });
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Serializes design tokens to W3C Design Token Community Group (DTCG) JSON format.
 */
export function tokensToDtcg(tokens: DesignTokens): Record<string, unknown> {
  const colorTokens: Record<string, { $value: string; $type: string }> = {};
  tokens.colors.forEach((c) => {
    colorTokens[c.name] = { $value: c.hex, $type: "color" };
  });

  const fontSizeTokens: Record<string, { $value: string; $type: string }> = {};
  tokens.typography.fontSizeScale.forEach((fs, i) => {
    fontSizeTokens[`step-${i + 1}`] = { $value: `${fs}px`, $type: "dimension" };
  });

  const spacingTokens: Record<string, { $value: string; $type: string }> = {};
  tokens.spacing.forEach((s, i) => {
    spacingTokens[`space-${i + 1}`] = { $value: `${s}px`, $type: "dimension" };
  });

  return {
    $version: "1.0",
    color: colorTokens,
    typography: {
      fontSize: fontSizeTokens,
    },
    spacing: spacingTokens,
  };
}

/**
 * Serializes design tokens to a Tailwind CSS configuration extension snippet.
 */
export function tokensToTailwind(tokens: DesignTokens): string {
  const colorsObj: Record<string, string> = {};
  tokens.colors.forEach((c) => {
    colorsObj[c.name.replace(/^color-/, "")] = c.hex;
  });

  const fontSizesObj: Record<string, string> = {};
  tokens.typography.fontSizeScale.forEach((fs, i) => {
    fontSizesObj[`step-${i + 1}`] = `${fs}px`;
  });

  const spacingObj: Record<string, string> = {};
  tokens.spacing.forEach((s, i) => {
    spacingObj[`space-${i + 1}`] = `${s}px`;
  });

  return `// tailwind.config.js extension
module.exports = {
  theme: {
    extend: {
      colors: ${JSON.stringify(colorsObj, null, 8).slice(0, -1)}      },
      fontSize: ${JSON.stringify(fontSizesObj, null, 8).slice(0, -1)}      },
      spacing: ${JSON.stringify(spacingObj, null, 8).slice(0, -1)}      }
    }
  }
};`;
}
