import { describe, expect, it } from "vitest";
import {
  cagnotteAcceptsContributions,
  cagnottePayout,
  canAddUnionPhoto,
  canProposeCagnotte,
  earnedBadges,
  priceWithReferralCredit,
  referralOutcome,
  validClosingDate,
  validContribution,
} from "../src/celebration";

const opened = new Date("2026-11-01T10:00:00Z");
const days = (n: number) => new Date(opened.getTime() + n * 86_400_000);

describe("Espace souvenir (phase 4, question 1)", () => {
  it("photos de l'union : couple uni seulement, 3 par membre", () => {
    expect(canAddUnionPhoto("active", 0)).toBe("not_union");
    expect(canAddUnionPhoto("union_celebrated", 2)).toBe("ok");
    expect(canAddUnionPhoto("union_celebrated", 3)).toBe("limit");
  });
});

describe("Cagnotte (phase 4, question 3)", () => {
  it("ouverture dès « Dot ou mariage » ou après l'union, une seule à la fois", () => {
    expect(canProposeCagnotte({ coupleStatus: "active", dowryOrWeddingReached: false, hasActiveCagnotte: false })).toBe("too_early");
    expect(canProposeCagnotte({ coupleStatus: "active", dowryOrWeddingReached: true, hasActiveCagnotte: false })).toBe("ok");
    expect(canProposeCagnotte({ coupleStatus: "union_celebrated", dowryOrWeddingReached: false, hasActiveCagnotte: false })).toBe("ok");
    expect(canProposeCagnotte({ coupleStatus: "separated", dowryOrWeddingReached: true, hasActiveCagnotte: false })).toBe("invalid_status");
    expect(canProposeCagnotte({ coupleStatus: "active", dowryOrWeddingReached: true, hasActiveCagnotte: true })).toBe("already_open");
  });

  it("clôture dans le futur, au plus 90 jours", () => {
    expect(validClosingDate(opened, days(90))).toBe(true);
    expect(validClosingDate(opened, days(91))).toBe(false);
    expect(validClosingDate(opened, opened)).toBe(false);
  });

  it("contribution d'au moins 1 000 FCFA, en entier", () => {
    expect(validContribution(1000)).toBe(true);
    expect(validContribution(999)).toBe(false);
    expect(validContribution(1500.5)).toBe(false);
  });

  it("reversement : commission arrondie à l'entier inférieur (0 % au lancement)", () => {
    expect(cagnottePayout(50_000, 0)).toEqual({ commission: 0, payout: 50_000 });
    expect(cagnottePayout(10_001, 3)).toEqual({ commission: 300, payout: 9_701 });
  });

  it("contributions acceptées seulement si ouverte et non échue", () => {
    expect(cagnotteAcceptsContributions("open", days(10), days(9))).toBe(true);
    expect(cagnotteAcceptsContributions("open", days(10), days(10))).toBe(false);
    expect(cagnotteAcceptsContributions("proposed", days(10), days(1))).toBe(false);
    expect(cagnotteAcceptsContributions("closed", days(10), days(1))).toBe(false);
  });
});

describe("Parrainage (phase 4, question 4)", () => {
  it("acquis à la première soirée payée et pointée, récompensé 5 fois par an", () => {
    expect(referralOutcome({ referredAttendedPaidEvening: false, rewardedThisYear: 0 })).toBe("pending");
    expect(referralOutcome({ referredAttendedPaidEvening: true, rewardedThisYear: 4 })).toBe("acquired_rewarded");
    expect(referralOutcome({ referredAttendedPaidEvening: true, rewardedThisYear: 5 })).toBe("acquired_not_rewarded");
  });

  it("réduction de 2 000 FCFA, jamais en dessous de 0", () => {
    expect(priceWithReferralCredit(10_000, 2_000)).toBe(8_000);
    expect(priceWithReferralCredit(1_000, 2_000)).toBe(0);
  });
});

describe("Badges de confiance (phase 4, question 5)", () => {
  const base = {
    verified: true,
    eveningsAttended: 2,
    profileComplete: true,
    approvedPhoto: true,
    acquiredReferrals: 1,
    suspended: false,
  };

  it("les quatre badges quand toutes les conditions sont remplies", () => {
    expect(earnedBadges(base)).toEqual(["identity_verified", "evenings_attended", "profile_complete", "sponsor"]);
  });

  it("chaque condition manquante retire son badge", () => {
    expect(earnedBadges({ ...base, eveningsAttended: 1 })).not.toContain("evenings_attended");
    expect(earnedBadges({ ...base, approvedPhoto: false })).not.toContain("profile_complete");
    expect(earnedBadges({ ...base, acquiredReferrals: 0 })).not.toContain("sponsor");
    expect(earnedBadges({ ...base, verified: false })).not.toContain("identity_verified");
  });

  it("aucun badge pendant une suspension", () => {
    expect(earnedBadges({ ...base, suspended: true })).toEqual([]);
  });
});
