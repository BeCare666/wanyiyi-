import { RULES } from "@wanyiyi/shared";

/**
 * Dates à l'heure de Cotonou (Africa/Porto-Novo, UTC+1, sans heure d'été).
 * Les calculs passent par Intl pour ne pas dépendre du fuseau de la machine.
 */

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RULES.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

export function cotonouParts(date: Date): LocalParts {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Décalage de Cotonou par rapport à UTC, en minutes, à l'instant donné. */
function offsetMinutes(date: Date): number {
  const p = cotonouParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

/** Instant correspondant à une date et une heure locales de Cotonou. */
export function cotonouDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guess.getTime() - offsetMinutes(guess) * 60_000);
}

/** Âge révolu, à l'heure de Cotonou, d'une personne née le `birthDate` (AAAA-MM-JJ). */
export function ageAt(birthDate: string, at: Date): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) throw new RangeError(`Date de naissance invalide : ${birthDate}`);
  const [by, bm, bd] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const now = cotonouParts(at);
  let age = now.year - by;
  if (now.month < bm || (now.month === bm && now.day < bd)) age -= 1;
  return age;
}
