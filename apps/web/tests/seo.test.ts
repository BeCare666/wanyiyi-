import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localizedPath, pageAlternates } from "../src/lib/seo";

describe("adresses canoniques des pages publiques", () => {
  it("français sans préfixe, autres langues préfixées", () => {
    expect(localizedPath("fr", "/")).toBe("/");
    expect(localizedPath("en", "/")).toBe("/en");
    expect(localizedPath("fr", "/contact")).toBe("/contact");
    expect(localizedPath("yo", "/contact")).toBe("/yo/contact");
  });

  it("chaque page a sa canonique et ses trois variantes, jamais celles de l'accueil", () => {
    expect(pageAlternates("en", "/prestataires")).toEqual({
      canonical: "/en/prestataires",
      languages: { fr: "/prestataires", en: "/en/prestataires", yo: "/yo/prestataires" },
    });
  });

  it("les pages indexées de la vitrine déclarent leur propre canonique", () => {
    const pages = ["a-propos", "confidentialite", "contact", "mentions-legales", "prestataires", "reglement"];
    for (const page of pages) {
      const src = readFileSync(join(__dirname, "../src/app/[locale]/(vitrine)", page, "page.tsx"), "utf8");
      expect(src, page).toContain(`pageAlternates(locale, "/${page}")`);
    }
  });
});
