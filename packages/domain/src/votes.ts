import { RULES } from "@wanyiyi/shared";
import { cotonouDate, cotonouParts } from "./time";

/**
 * Vote par code QR et calcul des matchs (section 9.3).
 *
 * - Le code QR d'une table n'est valable que pendant la soirée.
 * - Après chaque tour : « Je souhaite revoir cette personne » ou « Non »,
 *   plus une appréciation facultative visible uniquement par l'équipe.
 * - Un vote est modifiable jusqu'à la fin de la soirée.
 * - Match uniquement si les deux ont dit oui. Annonce : à la fermeture de la soirée par l'équipe (base, 03/11/2026) ;
 *   matchAnnouncementAt (lendemain 8 h) n'est plus utilisé par la base.
 * - Personne ne voit jamais qui a dit non : les résultats d'un membre ne contiennent
 *   que ses matchs.
 */

export type EveningWindow = { startsAt: Date; endsAt: Date };

export type Appreciation = {
  respect?: 1 | 2 | 3 | 4 | 5;
  punctuality?: 1 | 2 | 3 | 4 | 5;
  seriousness?: 1 | 2 | 3 | 4 | 5;
};

export type Vote = {
  voterId: string;
  targetId: string;
  wantsToSeeAgain: boolean;
  /** Réservée à l'équipe, jamais transmise aux membres. */
  appreciation?: Appreciation;
  updatedAt: Date;
};

export type Participant = { memberId: string; sex: "female" | "male"; checkedIn: boolean };

export type VoteRefusal = "outside_evening" | "voter_absent" | "target_absent" | "same_sex" | "self";

export class VoteError extends Error {
  constructor(readonly reason: VoteRefusal) {
    super(reason);
  }
}

/** Le code QR d'une table est valable du début à la fin de la soirée. */
export function isQrValid(evening: EveningWindow, now: Date): boolean {
  return evening.startsAt <= now && now <= evening.endsAt;
}

function check(evening: EveningWindow, participants: Participant[], vote: Vote, now: Date): VoteRefusal | null {
  if (!isQrValid(evening, now)) return "outside_evening";
  if (vote.voterId === vote.targetId) return "self";
  const voter = participants.find((p) => p.memberId === vote.voterId);
  const target = participants.find((p) => p.memberId === vote.targetId);
  if (!voter?.checkedIn) return "voter_absent";
  if (!target?.checkedIn) return "target_absent";
  if (voter.sex === target.sex) return "same_sex";
  return null;
}

/**
 * Enregistre ou modifie un vote. Un seul vote par votant et par personne rencontrée :
 * le nouveau vote remplace l'ancien tant que la soirée n'est pas terminée.
 */
export function castVote(evening: EveningWindow, participants: Participant[], votes: Vote[], vote: Vote, now: Date): Vote[] {
  const refusal = check(evening, participants, vote, now);
  if (refusal) throw new VoteError(refusal);
  const others = votes.filter((v) => !(v.voterId === vote.voterId && v.targetId === vote.targetId));
  return [...others, { ...vote, updatedAt: now }];
}

export type Match = { memberA: string; memberB: string };

/** Paires où chacun a dit oui à l'autre. Ordre stable : identifiants triés. */
export function computeMatches(votes: Vote[]): Match[] {
  const yes = new Set(votes.filter((v) => v.wantsToSeeAgain).map((v) => `${v.voterId}\u0000${v.targetId}`));
  const matches: Match[] = [];
  for (const key of yes) {
    const [a, b] = key.split("\u0000") as [string, string];
    if (a < b && yes.has(`${b}\u0000${a}`)) matches.push({ memberA: a, memberB: b });
  }
  return matches.sort((x, y) => (x.memberA + x.memberB).localeCompare(y.memberA + y.memberB));
}

/** Résultat visible par un membre : uniquement les personnes avec qui il y a match. */
export function matchesFor(memberId: string, matches: Match[]): string[] {
  return matches.flatMap((m) => (m.memberA === memberId ? [m.memberB] : m.memberB === memberId ? [m.memberA] : []));
}

/** Annonce des matchs : le lendemain de la soirée (date locale du début) à 8 h, heure de Cotonou. */
export function matchAnnouncementAt(evening: EveningWindow): Date {
  const day = cotonouParts(evening.startsAt);
  const next = new Date(Date.UTC(day.year, day.month - 1, day.day + 1));
  return cotonouDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), RULES.votes.matchAnnouncementHour);
}

/** Les matchs ne sont visibles des membres qu'à partir de l'heure d'annonce. */
export function areMatchesAnnounced(evening: EveningWindow, now: Date): boolean {
  return now >= matchAnnouncementAt(evening);
}

/** Match d'une soirée avec le tour où les deux se sont rencontrés. */
export type RoundMatch = Match & { round: number };

/**
 * 3 matchs au plus par soirée et par personne (06/11/2026), même règle que
 * app.limit_evening_matches : tant qu'une personne en a plus, on prend celle qui en a le plus
 * (à égalité, le plus petit identifiant), on garde ses matchs avec les personnes qui en ont le
 * moins (à égalité, le tour le plus tôt), et on retire les autres.
 */
export function limitEveningMatches(matches: readonly RoundMatch[], max: number = RULES.discovery.maxMatchesPerEvening): RoundMatch[] {
  let kept = [...matches];
  const count = (id: string) => kept.filter((m) => m.memberA === id || m.memberB === id).length;
  for (;;) {
    const members = [...new Set(kept.flatMap((m) => [m.memberA, m.memberB]))];
    const over = members
      .filter((id) => count(id) > max)
      .sort((a, b) => count(b) - count(a) || (a < b ? -1 : a > b ? 1 : 0))[0];
    if (!over) return kept;
    const partner = (m: RoundMatch) => (m.memberA === over ? m.memberB : m.memberA);
    const ranked = kept
      .filter((m) => m.memberA === over || m.memberB === over)
      .map((m) => ({ m, partnerCount: count(partner(m)) }))
      .sort((x, y) => x.partnerCount - y.partnerCount || x.m.round - y.m.round);
    const removed = new Set(ranked.slice(max).map((r) => r.m));
    kept = kept.filter((m) => !removed.has(m));
  }
}
