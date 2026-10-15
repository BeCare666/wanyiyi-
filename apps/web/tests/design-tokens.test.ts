import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Lit les jetons de couleur hexadécimaux du premier bloc :root de globals.css. */
function readTokens(): Record<string, string> {
  const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const tokens: Record<string, string> = {};
  for (const [, name, hex] of root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[name] = hex;
  }
  return tokens;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const tokens = readTokens();
const DARK_LINK = "#9db4d4"; // jeton --link du mode sombre

// [texte, fond, seuil] : 4.5 pour le texte courant, 3 pour les grands titres et les éléments d'interface
const pairs: Array<[string, string, number]> = [
  // Thème clair
  ["ink", "ivory", 4.5],
  ["stone-600", "ivory", 4.5],
  ["ink", "stone-100", 4.5],
  ["stone-600", "stone-100", 4.5],
  ["ivory", "rose-deep", 4.5],
  ["rose-deep", "ivory", 4.5],
  ["steel", "ivory", 4.5],
  ["ink", "rose-powder", 4.5],
  ["ink", "white", 4.5],
  // Sections sombres (sécurité, pied de page, hors ligne)
  ["ivory", "night", 4.5],
  ["stone-300", "night", 4.5],
  ["silver", "night", 4.5],
  ["silver", "ink", 4.5],
  ["rose-powder", "night", 3],
  ["ivory", "ink", 4.5],
  ["stone-300", "ink", 4.5],
  ["rose-powder", "ink", 4.5],
];

describe("Contrastes WCAG AA des jetons de couleur", () => {
  it("lit tous les jetons de la palette", () => {
    for (const name of ["ink", "ivory", "white", "rose-powder", "rose-deep", "night", "steel"]) {
      expect(tokens[name], name).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it.each(pairs)("%s sur %s atteint %d:1", (fg, bg, min) => {
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
  });

  it("le lien du mode sombre est lisible sur le noir encre et le bleu nuit", () => {
    expect(contrast(DARK_LINK, tokens.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK_LINK, tokens.night)).toBeGreaterThanOrEqual(4.5);
  });
});

/** Teinte (degrés) et chroma (0 à 1) d'une couleur hexadécimale. */
function hueChroma(hex: string): [number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return [0, 0];
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, d];
}

// Consigne du 14 octobre 2026 : aucune couleur or ou dorée, nulle part dans l'interface
describe("Aucune couleur dorée", () => {
  it("la palette ne contient aucun jeton doré", () => {
    const golden = Object.entries(tokens).filter(([name, hex]) => {
      const [h, s] = hueChroma(hex);
      return /gold|champagne|dore|or$/i.test(name) || (h >= 30 && h <= 60 && s > 0.15);
    });
    expect(golden).toEqual([]);
  });
});
