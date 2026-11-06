import { RULES } from "@wanyiyi/shared";

/**
 * Phase découverte (section 9.4). Règles du 06/11/2026 :
 *   - 3 matchs au plus par soirée et par personne (voir limitEveningMatches dans votes.ts) ;
 *   - plus de choix : à l'annonce, chaque match est choisi d'office par les deux et s'ouvre aussitôt
 *     en discussion ; les discussions des soirées précédentes restent ouvertes en plus ;
 *   - en couple, aucun nouveau match ne s'ouvre (exclusivité 9.5) ;
 *   - un ancien match encore en attente expire 7 jours après l'annonce ;
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

/** Choix d'office à l'annonce (06/11/2026) : tous les nouveaux matchs, sans limite de places. */
export function automaticChoices(newMatchIds: readonly string[]): string[] {
  return [...newMatchIds];
}

/** Fin de l'attente d'un match non ouvert : 7 jours après l'annonce. */
export function pendingExpiresAt(match: Pick<PendingMatch, "announcedAt">): Date {
  return new Date(match.announcedAt.getTime() + RULES.discovery.pendingMatchExpiryDays * DAY);
}

export function isPendingExpired(match: PendingMatch, now: Date): boolean {
  return match.status === "pending" && now.getTime() >= pendingExpiresAt(match).getTime();
}

export type ChoiceRefusal = "not_member" | "not_pending" | "expired" | "already_chosen" | "couple_exclusivity";

/** Choix d'un ancien match encore en attente (avant le 06/11/2026). En couple, aucun nouveau match ne s'ouvre. */
export function canChooseMatch(match: PendingMatch, memberId: string, ctx: { now: Date; inCouple: boolean }): ChoiceRefusal | null {
  if (!match.members.includes(memberId)) return "not_member";
  if (match.status !== "pending") return "not_pending";
  if (isPendingExpired(match, ctx.now)) return "expired";
  if (match.chosenBy.includes(memberId)) return "already_chosen";
  if (ctx.inCouple) return "couple_exclusivity";
  return null;
}

/** La découverte s'ouvre quand les deux ont choisi (d'office à l'annonce) et qu'aucun n'est en couple. */
export function shouldOpen(match: PendingMatch, inCouple: (memberId: string) => boolean): boolean {
  return match.status === "pending" && match.members.every((m) => match.chosenBy.includes(m) && !inCouple(m));
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
