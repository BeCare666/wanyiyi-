import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const locales = ["fr", "en", "yo"] as const;

function load(locale: string): Json {
  return JSON.parse(readFileSync(join(__dirname, `../messages/${locale}.json`), "utf8"));
}

/** Toutes les chaînes d'un fichier de traduction, avec leur chemin. */
function strings(node: Json, path = ""): Array<[string, string]> {
  if (typeof node === "string") return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((n, i) => strings(n, `${path}[${i}]`));
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  }
  return [];
}

/** Clés (structure) d'un fichier de traduction, sans les valeurs. */
function shape(node: Json, path = ""): string[] {
  if (Array.isArray(node)) return [`${path}[${node.length}]`, ...node.flatMap((n, i) => shape(n, `${path}[${i}]`))];
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => [path ? `${path}.${k}` : k, ...shape(v, path ? `${path}.${k}` : k)]);
  }
  return [];
}

// Règle 3.8 : aucun tiret long, demi-cadratin ou double tiret dans les textes visibles
const forbiddenDashes = /[—–]|--/;

// Règle 3.8 : aucune formule creuse ou artificielle
const hollowWords: Record<string, RegExp> = {
  fr: /\b(découvrez|libérez|sans effort|révolutionnaire|boostez)\b/i,
  en: /\b(discover|unlock|unleash|effortless(ly)?|revolutionary|boost)\b/i,
};

describe("Règles de rédaction (section 3.8)", () => {
  for (const locale of locales) {
    const entries = strings(load(locale));

    it(`${locale} : aucun tiret long ni double tiret`, () => {
      const offenders = entries.filter(([, s]) => forbiddenDashes.test(s));
      expect(offenders).toEqual([]);
    });

    if (hollowWords[locale]) {
      it(`${locale} : aucune formule creuse`, () => {
        const offenders = entries.filter(([, s]) => hollowWords[locale].test(s));
        expect(offenders).toEqual([]);
      });
    }

    it(`${locale} : aucune chaîne vide`, () => {
      expect(entries.filter(([, s]) => s.trim() === "")).toEqual([]);
    });
  }
});

/** Fichiers .ts et .tsx du site. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Clés écrites en toutes lettres dans le code : `const t = useTranslations("Espace")` (ou
 * getTranslations) puis `t("clé")`, jusqu'à la liaison suivante du même nom (un composant
 * par liaison). Les clés composées (`t(\`kinds.${x}\`)`) ne sont pas lues.
 */
function literalKeys(file: string): string[] {
  const code = readFileSync(file, "utf8");
  const bindings = [...code.matchAll(/const (\w+) = (?:await )?(?:useTranslations|getTranslations)\(\s*(?:"([\w.]+)")?\s*\)/g)];
  return bindings.flatMap(({ 1: name, 2: namespace, index }, i) => {
    const next = bindings.slice(i + 1).find((b) => b[1] === name);
    const scope = code.slice(index, next?.index ?? code.length);
    return [...scope.matchAll(new RegExp(`\\b${name}\\("([\\w.]+)"`, "g"))].map(([, key]) => (namespace ? `${namespace}.${key}` : key));
  });
}

describe("Cohérence des traductions (section 4)", () => {
  const reference = shape(load("fr")).sort();

  for (const locale of ["en", "yo"] as const) {
    it(`${locale} a exactement les mêmes clés que le français`, () => {
      expect(shape(load(locale)).sort()).toEqual(reference);
    });
  }

  it("chaque clé écrite dans le code a son texte", () => {
    const known = new Set(reference);
    const missing = sources(join(__dirname, "../src")).flatMap((file) =>
      literalKeys(file)
        .filter((key) => !known.has(key))
        .map((key) => `${relative(join(__dirname, ".."), file)} : ${key}`),
    );
    expect(missing).toEqual([]);
    // Lecture de tout src : plusieurs secondes sur un poste lent
  }, 60_000);
});
