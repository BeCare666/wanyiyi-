import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le motif du proxy doit rester une valeur écrite dans proxy.ts (Next.js l'analyse à la compilation).
 * Ce test lit sa valeur réelle, telle que JavaScript l'interprète, et vérifie les adresses couvertes.
 * Régression du 17 octobre 2026 : « \. » au lieu de « \\. » excluait toute page sauf « / ».
 */
const source = readFileSync(join(__dirname, "../src/proxy.ts"), "utf8");
const literal = /matcher:\s*("(?:[^"\\]|\\.)*")/.exec(source)?.[1];
const pattern = new Function(`return ${literal}`)() as string;
const covered = (path: string) => new RegExp(`^${pattern}$`).test(path);

describe("Proxy : langue et session sur toutes les pages", () => {
  it("couvre l'accueil et toutes les pages, avec ou sans préfixe de langue", () => {
    for (const path of ["/", "/inscription", "/reglement", "/connexion", "/espace/soirees", "/en/inscription", "/yo/admin/verifications"]) {
      expect(covered(path), path).toBe(true);
    }
  });

  it("laisse de côté l'API, les fichiers internes de Next.js et les fichiers statiques", () => {
    for (const path of ["/api/vote", "/_next/static/chunk.js", "/_vercel/insights", "/icon.svg", "/images/hero.webp"]) {
      expect(covered(path), path).toBe(false);
    }
  });
});
