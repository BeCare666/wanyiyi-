/**
 * Parrainage (phase 4, question 4 de PROPOSITIONS-QUESTIONS-PHASE4.txt, validée le 27 octobre
 * 2026) : code personnel de 8 caractères, lien d'inscription partageable par WhatsApp, code
 * saisi à l'inscription. Mêmes règles que app.set_referrer (migration 20261028000300).
 */

/** Paramètre du lien d'inscription : /inscription?parrain=CODE. */
export const REFERRAL_PARAM = "parrain";
/** Code gardé dans le navigateur entre le lien et l'étape identité (après la confirmation de l'adresse). */
export const REFERRAL_STORAGE_KEY = "ifedele.parrain";

export function normalizeReferralCode(raw: string): string {
  return raw.replace(/\s/g, "").toUpperCase();
}

export function isReferralCode(raw: string): boolean {
  return /^[0-9A-F]{8}$/.test(normalizeReferralCode(raw));
}

export function referralLink(siteUrl: string, code: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/inscription?${REFERRAL_PARAM}=${encodeURIComponent(code)}`;
}

/** Ligne de app.my_referrals() : prénom du filleul (null après la suppression de son compte) et état. */
export type ReferralRow = { first_name: string | null; acquired: boolean; rewarded: boolean; created_at: string };

/** Ligne de app.my_credits() : réductions de parrainage, utilisées ou non. */
export type CreditRow = { amount_xof: number; created_at: string; used_at: string | null };

/** Réductions encore disponibles (chacune s'applique à une soirée). */
export function availableCredits(rows: readonly CreditRow[]): CreditRow[] {
  return rows.filter((r) => r.used_at === null);
}
