import { RULES } from "@wanyiyi/shared";

/**
 * Soirées à venir affichées sur la vitrine.
 * En phase 1, la source est un jeu de données de démonstration (profils et soirées fictifs).
 * En phase 2, la même forme de données viendra de Supabase (table events).
 */

export type EveningTheme =
  | "open"
  | "age-25-35"
  | "age-35-45"
  | "age-45-plus"
  | "faith-christian"
  | "faith-muslim"
  | "professionals";

export type UpcomingEvening = {
  id: string;
  startsAt: string; // ISO 8601, UTC
  theme: EveningTheme;
  capacityWomen: number;
  capacityMen: number;
  bookedWomen: number;
  bookedMen: number;
};

export const MAX_CAPACITY_PER_SEX = RULES.evenings.maxCapacityPerSex;
export const DEFAULT_CAPACITY_PER_SEX = RULES.evenings.defaultCapacityPerSex;

/** Places restantes pour un sexe, jamais négatives. */
export function seatsLeft(capacity: number, booked: number): number {
  return Math.max(0, capacity - booked);
}

/** Cotonou est à UTC+1 toute l'année (pas d'heure d'été). */
const COTONOU_UTC_OFFSET_HOURS = 1;

/** Date UTC correspondant à un jour donné à hh:mm, heure de Cotonou. */
function atCotonouTime(base: Date, daysAhead: number, hours: number, minutes: number): Date {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + daysAhead));
  d.setUTCHours(hours - COTONOU_UTC_OFFSET_HOURS, minutes, 0, 0);
  return d;
}

/** Nombre de jours jusqu'au prochain jour de la semaine voulu (0 = dimanche), strictement après aujourd'hui. */
function daysUntil(base: Date, weekday: number): number {
  const diff = (weekday - base.getUTCDay() + 7) % 7;
  return diff === 0 ? 7 : diff;
}

/** Données de démonstration : trois soirées par semaine (jeudi, vendredi, samedi), sur deux semaines. */
export function demoUpcomingEvenings(now: Date = new Date()): UpcomingEvening[] {
  const plan: Array<{ weekday: number; week: number; theme: EveningTheme; bw: number; bm: number }> = [
    { weekday: 4, week: 0, theme: "age-25-35", bw: 7, bm: 9 },
    { weekday: 5, week: 0, theme: "open", bw: 10, bm: 8 },
    { weekday: 6, week: 0, theme: "faith-christian", bw: 6, bm: 5 },
    { weekday: 4, week: 1, theme: "professionals", bw: 3, bm: 4 },
  ];

  return plan
    .map((p, i) => ({
      id: `demo-${i + 1}`,
      startsAt: atCotonouTime(now, daysUntil(now, p.weekday) + p.week * 7, 19, 30).toISOString(),
      theme: p.theme,
      capacityWomen: DEFAULT_CAPACITY_PER_SEX,
      capacityMen: DEFAULT_CAPACITY_PER_SEX,
      bookedWomen: p.bw,
      bookedMen: p.bm,
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Affiche les données de démonstration en développement, ou si SHOW_DEMO_DATA=true.
 * En production sans ce réglage, la section affiche un état vide élégant.
 */
export function shouldShowDemoData(): boolean {
  return process.env.SHOW_DEMO_DATA === "true" || process.env.NODE_ENV !== "production";
}
