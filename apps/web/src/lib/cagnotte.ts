/**
 * Cagnotte (phase 4, question 3 de PROPOSITIONS-QUESTIONS-PHASE4.txt, validée le 27 octobre 2026).
 * Logique pure du site ; mêmes contrôles que app.propose_cagnotte et app.create_contribution
 * (migration 20261028000200), qui restent juges.
 */

export const MAX_DURATION_DAYS = 90;
export const MESSAGE_MAX = 300;
export const NAME_MAX = 60;

export type CagnotteStatus = "proposed" | "open" | "closed" | "paid_out";

/** Ligne de app.my_cagnotte() : ses propres demandes seulement, jamais celles de l'autre. */
export type MyCagnotte = {
  id: string;
  status: CagnotteStatus;
  title: string;
  goal_xof: number | null;
  closes_at: string;
  opened_at: string | null;
  public_token: string | null;
  payout_phone: string;
  commission_percent: number | string;
  collected_xof: number;
  proposed_by_me: boolean;
  my_requests: string[];
  payout_pending: boolean;
  paid_out_xof: number;
  closed_reason: "date" | "couple" | "separation" | null;
};

/** Ligne de app.cagnotte_contributions() : nom null si anonyme, montant null si masqué. */
export type ContributionRow = { id: string; contributor_name: string | null; message: string | null; amount_xof: number | null; created_at: string };

/**
 * Ce que le membre voit et peut faire (question 3) :
 *   - propose : aucune cagnotte en cours, il peut en proposer une ;
 *   - toAnswer / waitingOther : proposition de l'autre à accepter, ou la sienne en attente ;
 *   - open / closed / paidOut : cagnotte ouverte, close (reversement possible), entièrement reversée.
 */
export type CagnotteView = "propose" | "toAnswer" | "waitingOther" | "open" | "closed" | "paidOut";

export function cagnotteView(row: MyCagnotte | null): CagnotteView {
  if (!row) return "propose";
  if (row.status === "proposed") return row.proposed_by_me ? "waitingOther" : "toAnswer";
  if (row.status === "open") return "open";
  if (row.status === "closed") return "closed";
  return "paidOut";
}

/**
 * Proposition possible : couple en cours après « Dot ou mariage », ou union ; aucune cagnotte en
 * cours (une cagnotte close attend d'abord son reversement).
 */
export function canProposeCagnotte(input: { status: string; blocked: boolean; dowryOrWeddingReached: boolean; view: CagnotteView }): boolean {
  if (input.blocked || (input.view !== "propose" && input.view !== "paidOut")) return false;
  if (input.status === "union_celebrated") return true;
  return input.status === "active" && input.dowryOrWeddingReached;
}

/** Numéro Mobile Money du Bénin (229, puis 8 ou 10 chiffres), normalisé en +229… ; null s'il est invalide. */
export function payoutPhone(raw: string): string | null {
  const digits = raw.replace(/\s/g, "");
  return /^\+?229(\d{8}|\d{10})$/.test(digits) ? `+${digits.replace(/^\+/, "")}` : null;
}

export type ProposalInput = { title: string; goal: string; closesOn: string; phone: string };
export type ProposalError = "invalid_title" | "invalid_goal" | "invalid_closing" | "invalid_phone";

/** Jours entre aujourd'hui (AAAA-MM-JJ, heure de Cotonou) et la date de fin choisie. */
function daysBetween(today: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function checkProposal(input: ProposalInput, today: string): ProposalError | null {
  const title = input.title.trim();
  if (title.length < 3 || title.length > 80) return "invalid_title";
  if (input.goal.trim() !== "") {
    const goal = Number(input.goal.replace(/\s/g, ""));
    if (!Number.isInteger(goal) || goal < 1000 || goal > 1_000_000_000) return "invalid_goal";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.closesOn)) return "invalid_closing";
  const days = daysBetween(today, input.closesOn);
  // Fin de journée du jour choisi : aujourd'hui permis, 89 jours après au plus (90 jours pleins)
  if (!(days >= 0 && days <= MAX_DURATION_DAYS - 1)) return "invalid_closing";
  if (!payoutPhone(input.phone)) return "invalid_phone";
  return null;
}

export type ContributionInput = { name: string; anonymous: boolean; message: string; amount: string; hideAmount: boolean };
export type ContributionError = "name_required" | "message_too_long" | "invalid_amount";

export function checkContribution(input: ContributionInput, minXof: number): ContributionError | null {
  if (!input.anonymous && (input.name.trim() === "" || input.name.trim().length > NAME_MAX)) return "name_required";
  if (input.message.trim().length > MESSAGE_MAX) return "message_too_long";
  const amount = Number(input.amount.replace(/\s/g, ""));
  if (!Number.isInteger(amount) || amount < minXof || amount > 10_000_000) return "invalid_amount";
  return null;
}

/** Montant saisi (espaces permis), en francs CFA entiers. */
export function amountOf(raw: string): number {
  return Number(raw.replace(/\s/g, ""));
}

/** Progression vers l'objectif, en pourcentage entier de 0 à 100. */
export function progressPercent(collected: number, goal: number | null): number | null {
  if (!goal || goal <= 0) return null;
  return Math.min(100, Math.floor((collected * 100) / goal));
}

/** Adresse publique de la cagnotte, à partager (sans nom ni photo du couple). */
export function cagnotteUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/cagnotte/${token}`;
}

/** Partage par WhatsApp : message court suivi de l'adresse. */
export function whatsappShare(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
}
