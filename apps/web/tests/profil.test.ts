import { INDIFFERENT, PROFILE_CATALOG } from "@wanyiyi/shared";
import { describe, expect, it } from "vitest";
import {
  type Answers,
  answersFrom,
  canBeDealbreaker,
  categoryOf,
  checkAnswer,
  isAnswered,
  profileSteps,
  progress,
  stepsFor,
  toggleValue,
} from "../src/app/[locale]/(membre)/espace/profil/profile";

/** Profil en étapes (section 8 de la note). */

const cat = (key: string) => categoryOf(key)!;

describe("Étapes du profil", () => {
  it("chaque catégorie du catalogue est dans une seule étape", () => {
    const placed = profileSteps.flatMap((s) => [...s.categories]);
    expect([...placed].sort()).toEqual(PROFILE_CATALOG.map((c) => c.key).sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("« Mes mots » seulement pour « Je me décris »", () => {
    expect(stepsFor("self")[0]!.key).toBe("words");
    expect(stepsFor("seeking").map((s) => s.key)).not.toContain("words");
  });
});

describe("Étiquettes sélectionnables", () => {
  it("choix unique : remplacé, puis retiré au second clic", () => {
    expect(toggleValue("self", cat("religion"), [], "muslim")).toEqual(["muslim"]);
    expect(toggleValue("self", cat("religion"), ["muslim"], "catholic")).toEqual(["catholic"]);
    expect(toggleValue("self", cat("religion"), ["catholic"], "catholic")).toEqual([]);
  });

  it("personnalité : 5 choix au plus pour « Je me décris »", () => {
    const five = ["calm", "joyful", "reserved", "sociable", "patient"];
    expect(toggleValue("self", cat("personality"), five, "funny")).toEqual(five);
    expect(toggleValue("self", cat("personality"), five, "calm")).toHaveLength(4);
  });

  it("« Ce que je recherche » : choix multiples, « Indifférent » exclut les autres", () => {
    expect(toggleValue("seeking", cat("religion"), ["muslim"], "catholic")).toEqual(["muslim", "catholic"]);
    expect(toggleValue("seeking", cat("religion"), ["muslim", "catholic"], INDIFFERENT)).toEqual([INDIFFERENT]);
    expect(toggleValue("seeking", cat("religion"), [INDIFFERENT], "muslim")).toEqual(["muslim"]);
  });
});

describe("Contrôle côté serveur", () => {
  it("accepte les options du catalogue, « Indifférent » en recherche seulement", () => {
    expect(checkAnswer("self", "religion", ["muslim"])).toEqual(["muslim"]);
    expect(checkAnswer("seeking", "religion", [INDIFFERENT])).toEqual([INDIFFERENT]);
    expect(checkAnswer("self", "religion", [INDIFFERENT])).toBeNull();
    expect(checkAnswer("seeking", "religion", ["muslim", INDIFFERENT])).toBeNull();
  });

  it("refuse plusieurs choix sur un choix unique, trop de traits, une catégorie ou une valeur inconnue", () => {
    expect(checkAnswer("self", "religion", ["muslim", "catholic"])).toBeNull();
    expect(checkAnswer("self", "personality", ["calm", "joyful", "reserved", "sociable", "patient", "funny"])).toBeNull();
    expect(checkAnswer("self", "skin", ["x"])).toBeNull();
    expect(checkAnswer("self", "religion", ["inconnue"])).toBeNull();
    expect(checkAnswer("other", "religion", ["muslim"])).toBeNull();
    expect(checkAnswer("self", "religion", "muslim")).toBeNull();
    expect(checkAnswer("self", "religion", [])).toEqual([]);
  });
});

describe("Progression et critères non négociables", () => {
  it("personnalité remplie à partir de 3 traits ; catégories facultatives hors progression", () => {
    expect(isAnswered("self", cat("personality"), ["calm", "joyful"])).toBe(false);
    expect(isAnswered("self", cat("personality"), ["calm", "joyful", "funny"])).toBe(true);
    const empty: Answers = { self: {}, seeking: {} };
    const required = PROFILE_CATALOG.filter((c) => !c.optional).length;
    expect(progress("self", empty, 0)).toEqual({ done: 0, total: required + 3 });
    expect(progress("seeking", answersFrom([{ side: "seeking", category: "religion", values: ["muslim"] }]), 0)).toEqual({ done: 1, total: required });
  });

  it("un critère non négociable porte sur une recherche précise", () => {
    expect(canBeDealbreaker(["muslim"])).toBe(true);
    expect(canBeDealbreaker([INDIFFERENT])).toBe(false);
    expect(canBeDealbreaker([])).toBe(false);
    expect(canBeDealbreaker(undefined)).toBe(false);
  });

  it("lignes inconnues de la base ignorées", () => {
    expect(answersFrom([{ side: "self", category: "inconnue", values: ["x"] }, { side: "x", category: "religion", values: ["muslim"] }])).toEqual({ self: {}, seeking: {} });
  });
});
