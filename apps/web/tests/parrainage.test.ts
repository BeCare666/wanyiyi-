import { describe, expect, it } from "vitest";
import { isMemberNavActive, memberNav, memberSecondary } from "../src/components/member/memberNav";
import { notificationHref } from "../src/components/member/notificationKinds";
import { knownBadges } from "../src/components/member/TrustBadges";
import { availableCredits, isReferralCode, normalizeReferralCode, referralLink } from "../src/lib/referral";

/** Parrainage et badges de confiance (phase 4, questions 4 et 5). */

describe("parrainage", () => {
  it("code de 8 caractères, saisi avec ou sans espaces ni majuscules", () => {
    expect(normalizeReferralCode(" a1b2 c3d4 ")).toBe("A1B2C3D4");
    expect(isReferralCode("a1b2c3d4")).toBe(true);
    expect(isReferralCode("A1B2C3D")).toBe(false);
    expect(isReferralCode("Z1B2C3D4")).toBe(false);
  });

  it("lien d'inscription partageable", () => {
    expect(referralLink("https://ifedele.example/", "A1B2C3D4")).toBe("https://ifedele.example/inscription?parrain=A1B2C3D4");
  });

  it("réductions encore disponibles", () => {
    const rows = [
      { amount_xof: 2000, created_at: "2026-10-01", used_at: "2026-10-10" },
      { amount_xof: 2000, created_at: "2026-10-20", used_at: null },
    ];
    expect(availableCredits(rows)).toEqual([rows[1]]);
  });

  it("entrée « Parrainage » dans le menu ; la notification y mène", () => {
    expect(memberSecondary).toContain(memberNav.referral);
    expect(isMemberNavActive(memberNav.referral, "/espace/parrainage")).toBe(true);
    expect(notificationHref("referral.acquired")).toEqual({ pathname: "/espace/parrainage" });
  });
});

describe("badges de confiance", () => {
  it("seulement les quatre badges connus, dans l'ordre d'affichage", () => {
    expect(knownBadges(["sponsor", "identity_verified", "inconnu"])).toEqual(["identity_verified", "sponsor"]);
    expect(knownBadges(null)).toEqual([]);
  });
});
