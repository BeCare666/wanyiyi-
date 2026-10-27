/**
 * Espace du couple (section 9.5 ; questions 6, 7, 9 et 10 d de la phase 3). Logique pure de la
 * page : ce que le membre peut voir et faire selon l'état du couple et de l'accès au conseiller.
 */

export type CoupleStatus = "active" | "paused" | "union_celebrated" | "separated" | "left";

/** Ligne de app.my_couple() : ses propres demandes seulement, jamais celles de l'autre. */
export type CoupleRow = {
  couple_id: string;
  partner_first_name: string;
  status: CoupleStatus;
  created_at: string;
  paused_at: string | null;
  blocked: boolean;
  my_requests: string[];
  counselor_name: string | null;
};

/** Dernier accès au conseiller du couple (table counselor_access, lue sous la RLS). */
export type CounselorAccess = {
  id: string;
  status: "requested" | "granted" | "refused" | "revoked";
  requested_by: string;
  accepted_at: string | null;
  price_xof: number | null;
  counselor_id?: string | null;
};

/** Parcours en 5 étapes (9.5), dans l'ordre. */
export const milestoneKinds = ["first_dates", "counselor_sessions", "family_introduction", "dowry_or_wedding", "celebration"] as const;
export type MilestoneKind = (typeof milestoneKinds)[number];

/** Couple en cours ou en pause : l'espace vit (photos, numéros, conseiller, fins possibles). */
export function isLive(status: CoupleStatus): boolean {
  return status === "active" || status === "paused";
}

/** Conversation lisible : couple en cours, en pause ou union (lecture seule) ; plus après une séparation ou un départ. */
export function chatReadable(status: CoupleStatus): boolean {
  return isLive(status) || status === "union_celebrated";
}

/** Envoi possible : couple en cours et non bloqué (la pause et l'union mettent le chat en lecture seule). */
export function chatOpen(couple: Pick<CoupleRow, "status" | "blocked">): boolean {
  return couple.status === "active" && !couple.blocked;
}

/**
 * État de l'accès au conseiller pour le membre (question 9) :
 *   - none : aucun accès en cours (il peut inviter) ;
 *   - waitingOther : il a invité, l'autre n'a pas encore répondu ;
 *   - toAnswer : l'autre a invité, il doit accepter ou refuser ;
 *   - toPay : l'autre a accepté son invitation, il doit payer l'accès ;
 *   - waitingPayment : il a accepté, celui qui a invité doit payer ;
 *   - awaitingAssignment : accès réglé, l'équipe désigne le conseiller ;
 *   - granted : le conseiller est dans la conversation.
 */
export type CounselorState = "none" | "waitingOther" | "toAnswer" | "toPay" | "waitingPayment" | "awaitingAssignment" | "granted";

export function counselorState(access: CounselorAccess | null, memberId: string, paid: boolean): CounselorState {
  if (!access || access.status === "refused" || access.status === "revoked") return "none";
  if (access.status === "granted") return "granted";
  const mine = access.requested_by === memberId;
  if (access.accepted_at === null) return mine ? "waitingOther" : "toAnswer";
  if (paid || (access.price_xof ?? 0) === 0) return "awaitingAssignment";
  return mine ? "toPay" : "waitingPayment";
}

/** Inviter un conseiller : couple vivant, non bloqué, sans accès en cours. */
export function canInviteCounselor(couple: Pick<CoupleRow, "status" | "blocked">, state: CounselorState): boolean {
  return isLive(couple.status) && !couple.blocked && state === "none";
}

/**
 * Date et heure saisies dans le champ « datetime-local » (AAAA-MM-JJTHH:MM), lues à l'heure de
 * Cotonou (UTC+1 toute l'année, sans heure d'été) ; null si la saisie n'est pas une vraie date.
 */
export function cotonouToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day, hour - 1, minute));
  // Rejette les dates impossibles (31 février…) que Date.UTC décalerait au mois suivant
  const back = new Date(date.getTime() + 3_600_000);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return date.toISOString();
}

/** Décisions à deux encore possibles (9.5, question 7) : union et séparation pendant le couple ; reprise en pause. */
export function availableDecisions(couple: Pick<CoupleRow, "status">): ("resume" | "union" | "separation" | "keep_chat")[] {
  if (couple.status === "paused") return ["resume", "union", "separation"];
  if (couple.status === "active") return ["union", "separation"];
  if (couple.status === "union_celebrated") return ["keep_chat"];
  return [];
}
