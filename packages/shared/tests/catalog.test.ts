import { describe, expect, it } from "vitest";
import { PROFILE_CATALOG, RULES } from "../src";

const byKey = Object.fromEntries(PROFILE_CATALOG.map((c) => [c.key, c]));

describe("Catalogue du profil (section 8.2)", () => {
  it("ne demande jamais le teint, l'ethnie, l'adresse exacte ni l'employeur", () => {
    const forbidden = /skin|complexion|ethni|tribe|address|employer/i;
    for (const c of PROFILE_CATALOG) {
      expect(c.key).not.toMatch(forbidden);
      for (const o of c.options) expect(o).not.toMatch(forbidden);
    }
  });

  it("demande 3 à 5 traits de personnalité parmi 10", () => {
    expect(byKey.personality?.options).toHaveLength(10);
    expect(byKey.personality?.min).toBe(RULES.profile.personalityMin);
    expect(byKey.personality?.max).toBe(RULES.profile.personalityMax);
  });

  it("ne montre l'argent, la famille élargie et le lieu de vie qu'après le match", () => {
    for (const key of ["money_management", "extended_family", "desired_location"]) {
      expect(byKey[key]?.visibility).toBe("after_match");
    }
  });

  it("ne montre jamais les revenus aux membres", () => {
    expect(byKey.income?.visibility).toBe("team");
    expect(byKey.income?.optional).toBe(true);
  });

  it("rend facultatives la taille et la silhouette", () => {
    expect(byKey.height?.optional).toBe(true);
    expect(byKey.build?.optional).toBe(true);
  });

  it("chaque catégorie a ses options (question 4 : taille par 10 cm, revenus, secteurs)", () => {
    for (const c of PROFILE_CATALOG) expect(c.options.length, c.key).toBeGreaterThan(0);
    expect(byKey.height?.options).toEqual(["under_150", "150_159", "160_169", "170_179", "180_189", "190_plus"]);
    expect(byKey.sector?.options).toContain("other");
  });

  it("couvre les 21 catégories de la note", () => {
    expect(PROFILE_CATALOG).toHaveLength(21);
  });
});

describe("Constantes des règles métier (section 9)", () => {
  it("reprend les durées et limites de la note", () => {
    expect(RULES.discovery.durationDays).toBe(14);
    expect(RULES.discovery.extensionDays).toBe(7);
    expect(RULES.discovery.maxActivePerMember).toBe(2);
    expect(RULES.discovery.pendingMatchExpiryDays).toBe(7);
    expect(RULES.evenings.maxCapacityPerSex).toBe(12);
    expect(RULES.evenings.confirmationHoursBefore).toBe(48);
    expect(RULES.couple.inactivityAlertDays).toBe(60);
    expect(RULES.couple.separationChatRetentionDays).toBe(90);
    expect(RULES.safety.signedPhotoUrlSeconds).toBe(300);
    expect(RULES.profile.maxDealbreakers).toBe(3);
  });

  it("utilise exactement le message de fermeture prévu, sans raison ni détail", () => {
    expect(RULES.discovery.closedMessage).toBe("Cette mise en relation est terminée.");
  });
});
