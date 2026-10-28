import { RULES } from "@wanyiyi/shared";

/**
 * Phase 4 (propositions validées le 27 octobre 2026, PROPOSITIONS-QUESTIONS-PHASE4.txt) :
 * espace souvenir (question 1), cagnotte (question 3), parrainage (question 4),
 * badges de confiance (question 5).
 */

// ---------------------------------------------------------------------
// Espace souvenir
// ---------------------------------------------------------------------

/** Un membre peut déposer une photo de l'union tant qu'il en a moins de 3 (refusées non comptées). */
export function canAddUnionPhoto(coupleStatus: string, photosOfMember: number): "ok" | "not_union" | "limit" {
  if (coupleStatus !== "union_celebrated") return "not_union";
  if (photosOfMember >= RULES.memorySpace.unionPhotosPerMember) return "limit";
  return "ok";
}

// ---------------------------------------------------------------------
// Cagnotte
// ---------------------------------------------------------------------

export type CagnotteStatus = "proposed" | "open" | "closed" | "paid_out" | "refunding";

/**
 * Ouverture : couple en cours avec l'étape « Dot ou mariage » franchie, ou union célébrée ;
 * une seule cagnotte ouverte (ou en attente d'accord) par couple.
 */
export function canProposeCagnotte(input: {
  coupleStatus: string;
  dowryOrWeddingReached: boolean;
  hasActiveCagnotte: boolean;
}): "ok" | "too_early" | "already_open" | "invalid_status" {
  if (input.hasActiveCagnotte) return "already_open";
  if (input.coupleStatus === "union_celebrated") return "ok";
  if (input.coupleStatus !== "active") return "invalid_status";
  return input.dowryOrWeddingReached ? "ok" : "too_early";
}

/** Date de clôture choisie : dans le futur, au plus 90 jours après l'ouverture. */
export function validClosingDate(openedAt: Date, closesAt: Date): boolean {
  const max = openedAt.getTime() + RULES.cagnotte.maxDurationDays * 86_400_000;
  return closesAt.getTime() > openedAt.getTime() && closesAt.getTime() <= max;
}

export function validContribution(amountXof: number): boolean {
  return Number.isInteger(amountXof) && amountXof >= RULES.cagnotte.minContributionXof;
}

/** Montant reversé : contributions réussies moins la commission (arrondie à l'entier inférieur). */
export function cagnottePayout(collectedXof: number, commissionPercent: number): { commission: number; payout: number } {
  const commission = Math.floor((collectedXof * commissionPercent) / 100);
  return { commission, payout: collectedXof - commission };
}

/** Une contribution n'est acceptée que si la cagnotte est ouverte et non échue. */
export function cagnotteAcceptsContributions(status: CagnotteStatus, closesAt: Date, now: Date): boolean {
  return status === "open" && now.getTime() < closesAt.getTime();
}

// ---------------------------------------------------------------------
// Parrainage
// ---------------------------------------------------------------------

/** Acquis à la première soirée payée ET pointée du filleul ; récompensé dans la limite de 5 par an. */
export function referralOutcome(input: {
  referredAttendedPaidEvening: boolean;
  rewardedThisYear: number;
}): "pending" | "acquired_rewarded" | "acquired_not_rewarded" {
  if (!input.referredAttendedPaidEvening) return "pending";
  return input.rewardedThisYear < RULES.referral.maxRewardedPerYear ? "acquired_rewarded" : "acquired_not_rewarded";
}

/** Prix d'une soirée après une réduction de parrainage (jamais négatif). */
export function priceWithReferralCredit(priceXof: number, creditXof: number): number {
  return Math.max(0, priceXof - creditXof);
}

// ---------------------------------------------------------------------
// Badges de confiance
// ---------------------------------------------------------------------

export const TRUST_BADGES = ["identity_verified", "evenings_attended", "profile_complete", "sponsor"] as const;
export type TrustBadge = (typeof TRUST_BADGES)[number];

/** Badges mérités ; aucun pendant une suspension (rendus à la fin). */
export function earnedBadges(input: {
  verified: boolean;
  eveningsAttended: number;
  profileComplete: boolean;
  approvedPhoto: boolean;
  acquiredReferrals: number;
  suspended: boolean;
}): TrustBadge[] {
  if (input.suspended) return [];
  const badges: TrustBadge[] = [];
  if (input.verified) badges.push("identity_verified");
  if (input.eveningsAttended >= RULES.badges.eveningsAttendedMin) badges.push("evenings_attended");
  if (input.profileComplete && input.approvedPhoto) badges.push("profile_complete");
  if (input.acquiredReferrals >= 1) badges.push("sponsor");
  return badges;
}
