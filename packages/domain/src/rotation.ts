import { RULES } from "@wanyiyi/shared";

/**
 * Rotation d'une soirée (section 9.2 de la note).
 *
 * - Les femmes restent assises : la femme n° w occupe la table w pendant toute la soirée.
 * - L'homme n° m commence à la table m, puis avance d'une table à chaque tour ;
 *   après la table N, il revient à la table 1.
 * - Nombre de tables et de tours : N = max(femmes, hommes). Après N tours,
 *   chaque personne a rencontré une fois chaque personne de l'autre sexe.
 * - Nombre inégal : une table sans femme, ou un homme absent d'une table,
 *   donne un tour de pause à la personne seule à cette table.
 */

export type Seat = {
  table: number;
  /** Numéro de la femme assise à cette table, ou null (table sans femme). */
  woman: number | null;
  /** Numéro de l'homme assis à cette table pendant ce tour, ou null. */
  man: number | null;
};

export type Round = {
  number: number;
  seats: Seat[];
  /** Rencontres réelles du tour (une femme et un homme à la même table). */
  meetings: Array<{ table: number; woman: number; man: number }>;
  /** Personnes en pause pendant ce tour. */
  pauses: Array<{ table: number; sex: "female" | "male"; number: number }>;
};

export class RotationError extends Error {}

function assertCount(label: string, count: number) {
  const max = RULES.evenings.maxCapacityPerSex;
  if (!Number.isInteger(count) || count < 1 || count > max) {
    throw new RotationError(`${label} : entre 1 et ${max} participants attendus, reçu ${count}`);
  }
}

/** Table de l'homme n° man au tour n° round (numérotation à partir de 1). */
export function tableOfMan(man: number, round: number, tables: number): number {
  return ((man - 1 + (round - 1)) % tables) + 1;
}

export function buildRotation(women: number, men: number): Round[] {
  assertCount("Femmes", women);
  assertCount("Hommes", men);
  const tables = Math.max(women, men);
  const rounds: Round[] = [];

  for (let r = 1; r <= tables; r++) {
    const manAtTable = new Map<number, number>();
    for (let m = 1; m <= men; m++) manAtTable.set(tableOfMan(m, r, tables), m);

    const seats: Seat[] = [];
    const meetings: Round["meetings"] = [];
    const pauses: Round["pauses"] = [];
    for (let t = 1; t <= tables; t++) {
      const woman = t <= women ? t : null;
      const man = manAtTable.get(t) ?? null;
      seats.push({ table: t, woman, man });
      if (woman !== null && man !== null) meetings.push({ table: t, woman, man });
      else if (woman !== null) pauses.push({ table: t, sex: "female", number: woman });
      else if (man !== null) pauses.push({ table: t, sex: "male", number: man });
    }
    rounds.push({ number: r, seats, meetings, pauses });
  }
  return rounds;
}
