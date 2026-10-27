import { RULES } from "@wanyiyi/shared";

/**
 * Phase découverte (section 9.4) et ouverture des découvertes (question 2 de la phase 3,
 * choix du 26 octobre 2026) :
 *   - 2 découvertes actives au plus par membre ;
 *   - une découverte ne s'ouvre que si les deux membres l'ont choisie et ont chacun une place ;
 *   - à l'annonce, les nouveaux matchs qui tiennent dans les places libres sont choisis d'office,
 *     sinon le membre choisit lui-même ;
 *   - un match non ouvert attend 7 jours après l'annonce, puis expire ;
 *   - 14 jours de découverte, une seule prolongation de 7 jours si les deux la demandent ;
 *   - « Je veux continuer » des deux : couple, et fermeture des autres découvertes des deux ;
 *   - toute fin donne le même message neutre, sans raison ni détail.
 */

const DAY = 86_400_000;

export type MatchStatus = "pending" | "open" | "expired" | "closed";

export type PendingMatch = {
  id: string;
  members: readonly [string, string];
  status: MatchStatus;
  announcedAt: Date;
  /** Membres qui ont choisi d'ouvrir la découverte (d'office ou par choix). */
  chosenBy: readonly string[];
};

export type DiscoveryStatus = "active" | "extended" | "continued" | "closed" | "expired";

export type Discovery = {
  id: string;
  matchId: string;
  members: readonly [string, string];
  status: DiscoveryStatus;
  openedAt: Date;
  extended: boolean;
};

export type DiscoveryDecision = { memberId: string; wantsToContinue: boolean; wantsExtension: boolean };

export const CLOSED_MESSAGE = RULES.discovery.closedMessage;

const isActive = (d: Discovery) => d.status === "active" || d.status === "extended";

/** Découvertes actives d'un membre. */
export function activeDiscoveries(memberId: string, discoveries: readonly Discovery[]): Discovery[] {
  return discoveries.filter((d) => isActive(d) && d.members.includes(memberId));
}

/** Places libres d'un membre (2 découvertes actives au plus). */
export function freeSlots(memberId: string, discoveries: readonly Discovery[]): number {
  return Math.max(0, RULES.discovery.maxActivePerMember - activeDiscoveries(memberId, discoveries).length);
}

/**
 * Choix d'office à l'annonce : si tous les nouveaux matchs du membre tiennent dans ses places
 * libres, ils sont tous choisis ; sinon aucun, et le membre choisit lui-même.
 */
export function automaticChoices(newMatchIds: readonly string[], slots: number): string[] {
  return newMatchIds.length <= slots ? [...newMatchIds] : [];
}

/** Fin de l'attente d'un match non ouvert : 7 jours après l'annonce. */
export function pendingExpiresAt(match: Pick<PendingMatch, "announcedAt">): Date {
  return new Date(match.announcedAt.getTime() + RULES.discovery.pendingMatchExpiryDays * DAY);
}

export function isPendingExpired(match: PendingMatch, now: Date): boolean {
  return match.status === "pending" && now.getTime() >= pendingExpiresAt(match).getTime();
}

export type ChoiceRefusal = "not_member" | "not_pending" | "expired" | "already_chosen" | "no_free_slot" | "couple_exclusivity";

/**
 * Le membre peut-il choisir ce match ? Il faut une place libre au moment du choix.
 * En couple, aucun nouveau match ne s'ouvre (exclusivité 9.5, à confirmer : question 13).
 */
export function canChooseMatch(
  match: PendingMatch,
  memberId: string,
  ctx: { now: Date; discoveries: readonly Discovery[]; inCouple: boolean },
): ChoiceRefusal | null {
  if (!match.members.includes(memberId)) return "not_member";
  if (match.status !== "pending") return "not_pending";
  if (isPendingExpired(match, ctx.now)) return "expired";
  if (match.chosenBy.includes(memberId)) return "already_chosen";
  if (ctx.inCouple) return "couple_exclusivity";
  if (freeSlots(memberId, ctx.discoveries) === 0) return "no_free_slot";
  return null;
}

/** La découverte s'ouvre quand les deux ont choisi et ont encore chacun une place. */
export function shouldOpen(match: PendingMatch, discoveries: readonly Discovery[]): boolean {
  return (
    match.status === "pending" &&
    match.members.every((m) => match.chosenBy.includes(m)) &&
    match.members.every((m) => freeSlots(m, discoveries) > 0)
  );
}

/** Fin de la découverte : 14 jours après l'ouverture, 21 avec la prolongation. */
export function discoveryEndsAt(d: Pick<Discovery, "openedAt" | "extended">): Date {
  const days = RULES.discovery.durationDays + (d.extended ? RULES.discovery.extensionDays : 0);
  return new Date(d.openedAt.getTime() + days * DAY);
}

/**
 * Demande de prolongation possible (question 3, 27 octobre 2026) : découverte active, pas encore
 * prolongée, pendant ses 4 derniers jours seulement.
 */
export function canRequestExtension(d: Pick<Discovery, "status" | "openedAt" | "extended">, now: Date): boolean {
  if (d.status !== "active" || d.extended) return false;
  const end = discoveryEndsAt(d).getTime();
  return now.getTime() < end && now.getTime() >= end - RULES.discovery.extensionRequestWindowDays * DAY;
}

export type DiscoveryOutcome = "couple" | "extend" | "close" | "none";

/**
 * Suite d'une découverte active selon les décisions des deux :
 *   - les deux veulent continuer : couple ;
 *   - les deux demandent la prolongation, pas encore prolongée : prolongation ;
 *   - échéance passée sans décision commune : fermeture ;
 *   - sinon rien.
 */
export function discoveryOutcome(d: Discovery, decisions: readonly DiscoveryDecision[], now: Date): DiscoveryOutcome {
  if (!isActive(d)) return "none";
  const of = (m: string) => decisions.find((x) => x.memberId === m);
  const both = (key: "wantsToContinue" | "wantsExtension") => d.members.every((m) => of(m)?.[key] === true);
  if (both("wantsToContinue")) return "couple";
  if (now.getTime() >= discoveryEndsAt(d).getTime()) return "close";
  if (both("wantsExtension") && !d.extended) return "extend";
  return "none";
}

/** Découvertes à fermer quand un couple se forme : toutes les autres découvertes actives des deux. */
export function discoveriesClosedByCouple(couple: Discovery, discoveries: readonly Discovery[]): string[] {
  return discoveries.filter((d) => d.id !== couple.id && isActive(d) && d.members.some((m) => couple.members.includes(m))).map((d) => d.id);
}
