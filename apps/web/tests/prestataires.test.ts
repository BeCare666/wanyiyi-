import { describe, expect, it } from "vitest";
import { visibleAdminNav } from "../src/components/admin/adminNav";
import { listSpecs, providersSpec } from "../src/components/admin/listRules";
import {
  checkProvider,
  groupByCategory,
  localized,
  type ProviderCategory,
  providerExportCell,
  type ProviderInput,
  type ProviderListRow,
  validCategoryKey,
  whatsappLink,
} from "../src/lib/providers";

/** Prestataires (phase 4, question 2) : contrôles, langues, regroupement, liste et menu de l'administration. */

const valid: ProviderInput = {
  name: "Saveurs de Ouidah",
  category: "caterer",
  description: { fr: "Cuisine béninoise" },
  phone: "+229 01 97 00 00 01",
  whatsapp: "",
  city: "Cotonou",
  district: "Fidjrossè",
  priceRange: "",
  isDemo: false,
};

describe("fiche d'un prestataire", () => {
  it("mêmes contrôles que la base", () => {
    expect(checkProvider(valid)).toBeNull();
    expect(checkProvider({ ...valid, name: " " })).toBe("name");
    expect(checkProvider({ ...valid, category: "" })).toBe("category");
    expect(checkProvider({ ...valid, description: { en: "Food" } })).toBe("description");
    expect(checkProvider({ ...valid, description: { fr: "x", yo: "y".repeat(601) } })).toBe("description_length");
    expect(checkProvider({ ...valid, phone: "01 97" })).toBe("phone");
    expect(checkProvider({ ...valid, phone: "", whatsapp: "" })).toBe("contact");
    expect(checkProvider({ ...valid, phone: "", whatsapp: "+22990000000" })).toBeNull();
    expect(checkProvider({ ...valid, city: "" })).toBe("place");
    expect(checkProvider({ ...valid, priceRange: "x".repeat(81) })).toBe("price_range");
  });

  it("texte dans la langue affichée, en français à défaut ; lien WhatsApp", () => {
    expect(localized({ fr: "Traiteurs", en: "Caterers" }, "en")).toBe("Caterers");
    expect(localized({ fr: "Traiteurs", en: " " }, "en")).toBe("Traiteurs");
    expect(localized(null, "yo")).toBe("");
    expect(whatsappLink("+229 90 00 00 00")).toBe("https://wa.me/22990000000");
  });

  it("clé de catégorie : minuscules, chiffres et tirets bas", () => {
    expect(validCategoryKey("henne")).toBe(true);
    expect(validCategoryKey("Henné")).toBe(false);
    expect(validCategoryKey("x")).toBe(false);
  });
});

describe("regroupement par catégorie", () => {
  const categories: ProviderCategory[] = [
    { key: "tailor", name: { fr: "Couturiers" }, position: 2, is_active: true },
    { key: "caterer", name: { fr: "Traiteurs" }, position: 1, is_active: true },
    { key: "other", name: { fr: "Autre" }, position: 6, is_active: false },
    { key: "decoration", name: { fr: "Décoration" }, position: 5, is_active: true },
  ];

  it("ordre des catégories, catégories inactives ou vides retirées", () => {
    const rows = [
      { id: "1", category: "tailor" },
      { id: "2", category: "caterer" },
      { id: "3", category: "other" },
    ];
    expect(groupByCategory(rows, categories).map((g) => [g.category.key, g.rows.map((r) => r.id)])).toEqual([
      ["caterer", ["2"]],
      ["tailor", ["1"]],
    ]);
  });
});

describe("administration", () => {
  it("liste filtrable « providers » et menu « Célébration » réservé à providers.manage", () => {
    expect(listSpecs.providers).toBe(providersSpec);
    expect(providersSpec.pathname).toBe("/admin/prestataires");
    expect(visibleAdminNav(["providers.manage"])).toEqual([
      { key: "celebration", items: [expect.objectContaining({ key: "providers", href: "/admin/prestataires" })] },
    ]);
    expect(visibleAdminNav(["events.manage"]).some((g) => g.key === "celebration")).toBe(false);
  });

  it("export : catégorie nommée, oui ou non, date", () => {
    const row = { name: "A", category: "caterer", is_active: true, is_demo: false, created_at: "2026-10-28T10:00:00Z", contacts: 3 } as ProviderListRow;
    const labels = { yesNo: (b: boolean) => (b ? "oui" : "non"), date: () => "28/10/2026", category: () => "Traiteurs" };
    expect(providerExportCell(row, "category", labels)).toBe("Traiteurs");
    expect(providerExportCell(row, "is_demo", labels)).toBe("non");
    expect(providerExportCell(row, "contacts", labels)).toBe(3);
    expect(providerExportCell(row, "created_at", labels)).toBe("28/10/2026");
  });
});
