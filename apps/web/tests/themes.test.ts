import { PROFILE_CATALOG } from "@wanyiyi/shared";
import { describe, expect, it } from "vitest";
import fr from "../messages/fr.json";
import { checkTheme, parseAge, type ThemeInput, themeName, themeParams, themeReligions, themeSectors } from "../src/app/[locale]/(admin)/admin/themes/themes";

/** Thèmes des soirées (questions 4 et 21, choix du 24 octobre 2026). */

const input = (change: Partial<ThemeInput> = {}): ThemeInput => ({
  name: { fr: "Univers de la santé", en: "", yo: "" },
  minAge: "",
  maxAge: "",
  religions: [],
  sectors: ["health"],
  ...change,
});

describe("Thèmes des soirées", () => {
  it("confessions du profil sans « autre » ni « aucune », secteurs du profil", () => {
    expect(themeReligions).toEqual(["catholic", "protestant_evangelical", "muslim", "traditional"]);
    expect(themeSectors).toHaveLength(17);
  });

  it("chaque option du catalogue a son libellé (Profile.<catégorie>.options)", () => {
    for (const c of PROFILE_CATALOG) {
      const labels = (fr.Profile as Record<string, { options: Record<string, string> }>)[c.key]!.options;
      for (const o of c.options) expect(labels[o], `${c.key}.${o}`).toBeTruthy();
    }
  });

  it("âge : vide, ou entier de 18 à 120", () => {
    expect(parseAge("")).toBeNull();
    expect(parseAge(" 25 ")).toBe(25);
    expect(parseAge("17")).toBeUndefined();
    expect(parseAge("2x")).toBeUndefined();
  });

  it("contrôles avant l'envoi : nom, âges, au moins un critère", () => {
    expect(checkTheme(input())).toBeNull();
    expect(checkTheme(input({ name: { fr: " ", en: "x", yo: "" } }))).toBe("name");
    expect(checkTheme(input({ minAge: "40", maxAge: "30" }))).toBe("age");
    expect(checkTheme(input({ sectors: [] }))).toBe("criteria");
    expect(checkTheme(input({ sectors: ["inconnu"] }))).toBe("criteria");
    expect(checkTheme(input({ sectors: [], minAge: "25", maxAge: "35" }))).toBeNull();
  });

  it("paramètres envoyés : valeurs hors catalogue écartées", () => {
    expect(themeParams(input({ religions: ["muslim", "other"], sectors: ["health", "x"], minAge: "30" }))).toEqual({
      p_name: { fr: "Univers de la santé", en: "", yo: "" },
      p_min_age: 30,
      p_max_age: null,
      p_religions: ["muslim"],
      p_sectors: ["health"],
    });
  });

  it("nom dans la langue affichée, en français à défaut, puis la clé", () => {
    const theme = { key: "faith-muslim", name: { fr: "Foi musulmane", en: "Muslim faith", yo: "" } };
    expect(themeName(theme, "en")).toBe("Muslim faith");
    expect(themeName(theme, "yo")).toBe("Foi musulmane");
    expect(themeName({ key: "ancien", name: {} }, "fr")).toBe("ancien");
  });
});
