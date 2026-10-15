import { describe, expect, it } from "vitest";
import { checkFreeText } from "../src/textGuard";

describe("Blocage des coordonnées dans les textes du profil (8.1)", () => {
  it("accepte un texte ordinaire, chiffres courts compris", () => {
    expect(checkFreeText("J'ai 34 ans, deux frères, et j'aime cuisiner le dimanche en famille.")).toEqual([]);
    expect(checkFreeText("Je travaille dans la santé depuis 2015 et je chante à la chorale.")).toEqual([]);
  });

  it.each([
    ["chiffres collés", "Appelez-moi au 0197123456"],
    ["chiffres espacés", "mon numéro : 01 97 12 34 56"],
    ["avec indicatif", "+229 01 97 12 34 56"],
    ["points et tirets", "01.97.12-34-56"],
    ["lettre o à la place du zéro", "O1 97 12 34 56"],
    ["chiffres en lettres", "zéro un neuf sept un deux trois quatre cinq six"],
    ["nombres en lettres", "zéro un quatre-vingt-dix-sept douze trente-quatre cinquante-six"],
    ["mélange lettres et chiffres", "01 quatre-vingt-dix-sept 12 34 56"],
    ["chiffres en anglais", "zero one nine seven one two three four five six"],
  ])("bloque un numéro de téléphone (%s)", (_, text) => {
    expect(checkFreeText(text)).toContain("phone");
  });

  it("bloque les adresses e-mail, y compris déguisées", () => {
    expect(checkFreeText("écrivez à afiwa.h@gmail.com")).toContain("email");
    expect(checkFreeText("afiwa arobase gmail point com")).toContain("email");
    expect(checkFreeText("afiwa (at) gmail (dot) com")).toContain("email");
  });

  it("bloque les liens", () => {
    expect(checkFreeText("voir https://exemple.bj/profil")).toContain("link");
    expect(checkFreeText("www.monsite.com")).toContain("link");
    expect(checkFreeText("wa.me/22901971234")).toContain("link");
  });

  it("bloque les pseudos de réseaux sociaux", () => {
    expect(checkFreeText("suivez @afiwa_cotonou")).toContain("social_handle");
    expect(checkFreeText("insta: afiwa.h")).toContain("social_handle");
    expect(checkFreeText("Snapchat = koffi229")).toContain("social_handle");
  });

  it("n'assimile pas une simple mention d'un réseau à un pseudo", () => {
    expect(checkFreeText("Je passe peu de temps sur Instagram, je préfère lire.")).toEqual([]);
  });

  it("limite la longueur à 300 caractères", () => {
    expect(checkFreeText("a".repeat(300))).toEqual([]);
    expect(checkFreeText("a".repeat(301))).toContain("too_long");
  });
});
