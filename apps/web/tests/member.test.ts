import { describe, expect, it } from "vitest";
import { defaultRound, isQrToken, parseVote, type Round } from "../src/app/[locale]/(membre)/vote/[qr]/vote";
import { isMemberNavActive, memberNav, memberPrimary } from "../src/components/member/memberNav";
import { safeNextPath, signInHref } from "../src/lib/next-path";
import { normalizePhone } from "../src/lib/phone";

describe("Retour après connexion", () => {
  it("accepte une adresse interne", () => {
    expect(safeNextPath("/vote/abc")).toBe("/vote/abc");
    expect(safeNextPath(["/espace/matchs", "/autre"])).toBe("/espace/matchs");
  });

  it("refuse toute redirection vers un autre site", () => {
    for (const value of ["https://exemple.com", "//exemple.com", "/\\exemple.com", "espace", "", undefined, null]) {
      expect(safeNextPath(value)).toBe("/espace");
    }
  });

  it("encode la page à rouvrir", () => {
    expect(signInHref("/vote/abc?x=1")).toBe("/connexion?suite=%2Fvote%2Fabc%3Fx%3D1");
  });
});

describe("Numéro de téléphone", () => {
  it("normalise un numéro international saisi avec des espaces", () => {
    expect(normalizePhone("+229 01 97 00 00 00")).toBe("+2290197000000");
  });

  it("refuse un numéro sans indicatif ou trop court", () => {
    expect(normalizePhone("0197000000")).toBeNull();
    expect(normalizePhone("+229")).toBeNull();
    expect(normalizePhone("+0229019700")).toBeNull();
  });
});

describe("Vote au code QR (9.3)", () => {
  it("n'accepte que les codes générés par la base (hexadécimal)", () => {
    expect(isQrToken("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2")).toBe(true);
    expect(isQrToken("../admin")).toBe(false);
    expect(isQrToken("ABC")).toBe(false);
  });

  it("garde le choix et les notes de 1 à 5, ignore les notes absentes", () => {
    expect(parseVote({ choice: "yes", respect: 5, punctuality: null })).toEqual({ choice: "yes", respect: 5 });
    expect(parseVote({ choice: "no" })).toEqual({ choice: "no" });
  });

  it("refuse un choix inconnu ou une note hors bornes", () => {
    expect(parseVote({ choice: "maybe" as "yes" })).toBeNull();
    expect(parseVote({ choice: "yes", seriousness: 6 })).toBeNull();
    expect(parseVote({ choice: "yes", respect: 2.5 })).toBeNull();
  });

  it("ouvre le premier tour sans vote, en sautant les pauses", () => {
    const rounds: Round[] = [
      { round_number: 1, is_pause: false, my_choice: "yes" },
      { round_number: 2, is_pause: true, my_choice: null },
      { round_number: 3, is_pause: false, my_choice: null },
    ];
    expect(defaultRound(rounds)).toBe(3);
    expect(defaultRound(rounds.map((r) => ({ ...r, my_choice: r.is_pause ? null : "no" })))).toBe(3);
    expect(defaultRound([])).toBeNull();
  });
});

describe("Navigation de l'espace membre (6.1)", () => {
  it("compte 4 sections principales pour la barre basse", () => {
    expect(memberPrimary.map((i) => i.key)).toEqual(["dashboard", "evenings", "matches", "profile"]);
  });

  it("le tableau de bord n'est actif que sur sa propre page", () => {
    expect(isMemberNavActive(memberNav.dashboard, "/espace")).toBe(true);
    expect(isMemberNavActive(memberNav.dashboard, "/espace/matchs")).toBe(false);
    expect(isMemberNavActive(memberNav.matches, "/espace/matchs")).toBe(true);
    expect(isMemberNavActive(memberNav.evenings, "/espace/soirees/123")).toBe(true);
    expect(isMemberNavActive(memberNav.evenings, "/espace/soireesx")).toBe(false);
  });
});
