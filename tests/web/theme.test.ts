import { describe, expect, test } from "bun:test";
import { copy } from "../../web/src/copy";
import { EPOCH_PALETTE, THEME_DEFAULTS } from "../../web/src/lib/theme";

function srgbToLin(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbToLin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type CvdMode = "normal" | "protan" | "deutan" | "tritan";

function simulateCvd(hex: string, mode: CvdMode): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(srgbToLin) as [number, number, number];
  if (mode === "normal") return [r, g, b];
  const matrices = {
    protan: [
      [0.152286, 1.052583, -0.204868],
      [0.114503, 0.786281, 0.099216],
      [-0.003882, -0.048116, 1.051998],
    ],
    deutan: [
      [0.367322, 0.860646, -0.227968],
      [0.280085, 0.672501, 0.047413],
      [-0.01182, 0.04294, 0.968881],
    ],
    tritan: [
      [1.255528, -0.076749, -0.178779],
      [-0.078411, 0.930809, 0.147602],
      [0.004733, 0.691367, 0.3039],
    ],
  } as const;
  const m = matrices[mode];
  return [
    Math.min(1, Math.max(0, m[0][0] * r + m[0][1] * g + m[0][2] * b)),
    Math.min(1, Math.max(0, m[1][0] * r + m[1][1] * g + m[1][2] * b)),
    Math.min(1, Math.max(0, m[2][0] * r + m[2][1] * g + m[2][2] * b)),
  ];
}

function linToLab([r, g, b]: [number, number, number]): [number, number, number] {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / 1.0;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const la = linToLab(a);
  const lb = linToLab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

describe("ui-design §9 color contrast and colorblind safety", () => {
  test("text and semantic tint tokens reach >= 4.5:1 on card and background", () => {
    const textTokens = [
      THEME_DEFAULTS.foreground,
      THEME_DEFAULTS.mutedForeground,
      THEME_DEFAULTS.accent,
      THEME_DEFAULTS.notable,
      THEME_DEFAULTS.alert,
      THEME_DEFAULTS.learning,
      THEME_DEFAULTS.partial,
    ];
    for (const hex of textTokens) {
      expect(contrastRatio(hex, THEME_DEFAULTS.card)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(hex, THEME_DEFAULTS.background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrastRatio(THEME_DEFAULTS.primaryForeground, THEME_DEFAULTS.accent),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("minor tint and all 6 epoch colors meet >= 3:1 non-text and >= 4.5:1 epoch contrast", () => {
    expect(contrastRatio(THEME_DEFAULTS.minor, THEME_DEFAULTS.card)).toBeGreaterThanOrEqual(3.0);
    for (const hex of EPOCH_PALETTE) {
      expect(contrastRatio(hex, THEME_DEFAULTS.card)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(hex, THEME_DEFAULTS.background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("epoch palette remains separable under normal vision and protan/deutan/tritan CVD", () => {
    const modes: readonly CvdMode[] = ["normal", "protan", "deutan", "tritan"];
    for (const mode of modes) {
      const points = EPOCH_PALETTE.map((h) => simulateCvd(h, mode));
      let minDe = Number.POSITIVE_INFINITY;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        if (!a) continue;
        for (let j = i + 1; j < points.length; j++) {
          const b = points[j];
          if (!b) continue;
          minDe = Math.min(minDe, deltaE(a, b));
        }
      }
      expect(minDe).toBeGreaterThanOrEqual(12);
    }
  });

  test("epoch palette stays distinct from semantic tints", () => {
    const semantics = [THEME_DEFAULTS.notable, THEME_DEFAULTS.alert, THEME_DEFAULTS.learning];
    for (const epochHex of EPOCH_PALETTE) {
      for (const semHex of semantics) {
        const de = deltaE(simulateCvd(epochHex, "normal"), simulateCvd(semHex, "normal"));
        expect(de).toBeGreaterThanOrEqual(25);
      }
    }
  });
});

describe("B-F9 neutral copy", () => {
  test("copy module avoids causal or judgmental wording", () => {
    const serialized = JSON.stringify(copy).toLowerCase();
    expect(serialized).not.toContain("caused");
    expect(serialized).not.toContain("better");
    expect(serialized).not.toContain("worse");
    expect(serialized).not.toContain("your watch is wrong");
  });
});
