import { RULES } from "@wanyiyi/shared";

/**
 * Déroulé minuté d'une soirée (section 9.2) : tours de 7 minutes, 1 minute de changement,
 * une pause après la moitié des tours. Sert au minuteur administrateur sur tablette.
 *
 * La durée de la pause n'est pas fixée par la note : elle est obligatoire ici
 * (question ouverte, voir propositions/PHASE2.txt).
 */

export type Slot =
  | { kind: "round"; round: number; start: Date; end: Date }
  | { kind: "changeover"; afterRound: number; start: Date; end: Date }
  | { kind: "break"; afterRound: number; start: Date; end: Date };

export type ScheduleInput = {
  start: Date;
  rounds: number;
  breakMinutes: number;
  roundMinutes?: number;
  changeoverMinutes?: number;
};

const MINUTE = 60_000;

/** Tour après lequel a lieu la pause : la moitié, arrondie à l'inférieur (question ouverte pour un nombre impair). */
export function breakAfterRound(rounds: number): number {
  return Math.floor(rounds / 2);
}

export function buildSchedule({
  start,
  rounds,
  breakMinutes,
  roundMinutes = RULES.evenings.roundMinutes,
  changeoverMinutes = RULES.evenings.changeoverMinutes,
}: ScheduleInput): Slot[] {
  if (!Number.isInteger(rounds) || rounds < 1) throw new RangeError("Nombre de tours invalide");
  if (breakMinutes < 0) throw new RangeError("Durée de pause invalide");

  const slots: Slot[] = [];
  const pauseAfter = breakAfterRound(rounds);
  let cursor = start.getTime();
  const push = (slot: Slot) => {
    slots.push(slot);
    cursor = slot.end.getTime();
  };

  for (let r = 1; r <= rounds; r++) {
    push({ kind: "round", round: r, start: new Date(cursor), end: new Date(cursor + roundMinutes * MINUTE) });
    if (r === rounds) break;
    // La pause remplace le changement de table qui suit la moitié des tours
    if (r === pauseAfter && breakMinutes > 0) {
      push({ kind: "break", afterRound: r, start: new Date(cursor), end: new Date(cursor + breakMinutes * MINUTE) });
    } else {
      push({ kind: "changeover", afterRound: r, start: new Date(cursor), end: new Date(cursor + changeoverMinutes * MINUTE) });
    }
  }
  return slots;
}

/** Créneau en cours à l'instant `now`, ou null avant le début et après la fin. */
export function currentSlot(slots: Slot[], now: Date): Slot | null {
  const t = now.getTime();
  return slots.find((s) => s.start.getTime() <= t && t < s.end.getTime()) ?? null;
}
