import { describe, expect, it } from "vitest";
import { dataFileName, dataSections, type MyData, plainText, sectionRows, valueKind } from "../src/app/[locale]/(membre)/espace/mes-donnees/data";
import { deletionError, isPrivacyField, privacyColumns, privacyFrom } from "../src/app/[locale]/(membre)/espace/parametres/settings";
import { notificationKey } from "../src/components/member/notificationKinds";

/** Paramètres du membre : questions 15 à 17, réponses du 24 octobre 2026. */

describe("Confidentialité (question 15)", () => {
  it("par défaut : photo cachée jusqu'au match, numéro partagé, photo non floutée (10.2)", () => {
    expect(privacyFrom(null)).toEqual({ photoHidden: true, sharePhone: true, keepBlurred: false });
    expect(privacyFrom({ photo_blurred: false, share_phone: false, keep_photo_blurred: true })).toEqual({ photoHidden: false, sharePhone: false, keepBlurred: true });
  });

  it("seuls les trois réglages prévus sont écrits, chacun sur sa colonne", () => {
    expect(isPrivacyField("photoHidden")).toBe(true);
    expect(isPrivacyField("status")).toBe(false);
    expect(privacyColumns).toEqual({ photoHidden: "photo_blurred", sharePhone: "share_phone", keepBlurred: "keep_photo_blurred" });
  });
});

describe("Mes données (question 16)", () => {
  const data: MyData = {
    exported_at: "2026-10-24T10:00:00Z",
    account: { member_number: "W000001" },
    profile: null,
    texts: [],
    answers: [],
    dealbreakers: ["religion", "children"],
    verification: [],
    honor_declarations: [],
    evenings: [{ starts_at: "2026-10-10T18:00:00Z", status: "checked_in" }],
    votes: [],
    matches: [],
    payments: [],
    notifications: [],
    notification_preferences: [],
    deletion: null,
  };

  it("chaque rubrique du fichier a sa place sur la page imprimable", () => {
    const keys = Object.keys(data).filter((k) => k !== "exported_at");
    expect([...dataSections].sort()).toEqual(keys.sort());
  });

  it("objet seul, liste d'objets, liste de libellés, rubrique vide", () => {
    expect(sectionRows(data, "account")).toEqual([{ member_number: "W000001" }]);
    expect(sectionRows(data, "profile")).toEqual([]);
    expect(sectionRows(data, "evenings")).toHaveLength(1);
    expect(sectionRows(data, "dealbreakers")).toEqual([{ category: "religion" }, { category: "children" }]);
  });

  it("mise en forme selon la nature de la valeur", () => {
    expect(valueKind("birth_date", "1994-05-14")).toBe("date");
    expect(valueKind("created_at", "2026-10-24T10:00:00Z")).toBe("dateTime");
    expect(valueKind("evening", "2026-10-10T18:00:00Z")).toBe("dateTime");
    expect(valueKind("purge_after", "2026-11-23T10:00:00Z")).toBe("dateTime");
    expect(valueKind("amount_xof", 10000)).toBe("amount");
    expect(valueKind("dark_mode", false)).toBe("boolean");
    expect(valueKind("city", null)).toBe("empty");
    expect(valueKind("city", "Cotonou")).toBe("text");
    expect(plainText(["a", "b"])).toBe("a, b");
    expect(plainText({})).toBe("");
    expect(plainText({ reason: "x" })).toBe('{"reason":"x"}');
  });

  it("nom du fichier daté", () => {
    expect(dataFileName("2026-10-24")).toBe("ifedele-mes-donnees-2026-10-24.json");
  });
});

describe("Suppression du compte (question 17)", () => {
  it("erreurs de la base traduites, les autres deviennent un échec générique", () => {
    expect(deletionError("upcoming_evening")).toBe("upcoming_evening");
    expect(deletionError("already_requested")).toBe("already_requested");
    expect(deletionError("no_request")).toBe("no_request");
    expect(deletionError("permission denied")).toBe("failed");
    expect(deletionError(undefined)).toBe("failed");
  });

  it("l'autre membre est prévenu par une notification connue", () => {
    expect(notificationKey("discovery.partner_left")).toBe("discovery_partner_left");
    expect(notificationKey("couple.partner_left")).toBe("couple_partner_left");
  });
});
