import { RULES } from "@wanyiyi/shared";
import { ageAt } from "./time";

/**
 * Réservation des soirées (section 9.2) :
 * quotas séparés par sexe, liste d'attente par sexe, seuls les membres validés réservent,
 * confirmation obligatoire 48 h avant, sinon la place passe à la liste d'attente,
 * soirées thématiques avec critères d'accès automatiques.
 * L'exclusivité de l'espace du couple (9.5) interdit aussi la réservation.
 */

export type Sex = "female" | "male";

export type Capacity = Record<Sex, number>;

export type RegistrationStatus = "booked" | "confirmed" | "waitlisted" | "cancelled" | "released";

export type Registration = {
  memberId: string;
  sex: Sex;
  status: RegistrationStatus;
  /** Date de réservation, ou d'entrée en liste d'attente : fixe l'ordre de la liste. */
  createdAt: Date;
  /** Date d'attribution de la place (réservation directe ou promotion depuis la liste d'attente). */
  seatedAt?: Date;
};

export type ThemeCriteria = {
  ageMin?: number;
  ageMax?: number;
  /** Valeurs du catalogue (religion). */
  religions?: string[];
  /** Valeurs du catalogue (secteur d'activité). */
  sectors?: string[];
};

export type Evening = {
  startsAt: Date;
  capacity: Capacity;
  theme?: ThemeCriteria;
};

export type Booker = {
  memberId: string;
  sex: Sex;
  verification: "pending" | "to_correct" | "validated" | "rejected";
  birthDate: string;
  religion?: string;
  sector?: string;
  /** Espace du couple ouvert : exclusivité, aucune réservation (9.5). */
  inCoupleSpace: boolean;
  /** Retour aux soirées interdit jusqu'à cette date (par exemple un mois après une séparation). */
  eveningsBlockedUntil?: Date;
};

export type BookingRefusal =
  | "not_validated"
  | "couple_exclusivity"
  | "blocked_until"
  | "already_registered"
  | "evening_closed"
  | "theme_age"
  | "theme_religion"
  | "theme_sector";

export type BookingDecision = { ok: true; outcome: "seat" | "waitlist" } | { ok: false; reason: BookingRefusal };

export class CapacityError extends Error {}

/** Capacité par sexe : 1 à 12, 10 par défaut. */
export function validateCapacity(capacity: Capacity): Capacity {
  for (const sex of ["female", "male"] as const) {
    const n = capacity[sex];
    if (!Number.isInteger(n) || n < 1 || n > RULES.evenings.maxCapacityPerSex) {
      throw new CapacityError(`Capacité ${sex} invalide : ${n} (maximum ${RULES.evenings.maxCapacityPerSex})`);
    }
  }
  return capacity;
}

export const defaultCapacity: Capacity = {
  female: RULES.evenings.defaultCapacityPerSex,
  male: RULES.evenings.defaultCapacityPerSex,
};

const HOUR = 3_600_000;

/** Limite de confirmation : 48 h avant le début de la soirée. */
export function confirmationDeadline(startsAt: Date): Date {
  return new Date(startsAt.getTime() - RULES.evenings.confirmationHoursBefore * HOUR);
}

const holdsSeat = (r: Registration) => r.status === "booked" || r.status === "confirmed";
const isActive = (r: Registration) => holdsSeat(r) || r.status === "waitlisted";

export function seatsTaken(registrations: Registration[], sex: Sex): number {
  return registrations.filter((r) => r.sex === sex && holdsSeat(r)).length;
}

export function seatsLeft(evening: Evening, registrations: Registration[], sex: Sex): number {
  return Math.max(0, evening.capacity[sex] - seatsTaken(registrations, sex));
}

/** Refus lié au thème de la soirée, ou null si le membre y a accès. */
export function themeRefusal(booker: Booker, evening: Evening): BookingRefusal | null {
  const theme = evening.theme;
  if (!theme) return null;
  const age = ageAt(booker.birthDate, evening.startsAt);
  if ((theme.ageMin !== undefined && age < theme.ageMin) || (theme.ageMax !== undefined && age > theme.ageMax)) {
    return "theme_age";
  }
  if (theme.religions?.length && (!booker.religion || !theme.religions.includes(booker.religion))) {
    return "theme_religion";
  }
  if (theme.sectors?.length && (!booker.sector || !theme.sectors.includes(booker.sector))) {
    return "theme_sector";
  }
  return null;
}

export function decideBooking(booker: Booker, evening: Evening, registrations: Registration[], now: Date): BookingDecision {
  if (booker.verification !== "validated") return { ok: false, reason: "not_validated" };
  if (booker.inCoupleSpace) return { ok: false, reason: "couple_exclusivity" };
  if (booker.eveningsBlockedUntil && now < booker.eveningsBlockedUntil) return { ok: false, reason: "blocked_until" };
  if (now >= evening.startsAt) return { ok: false, reason: "evening_closed" };
  if (registrations.some((r) => r.memberId === booker.memberId && isActive(r))) {
    return { ok: false, reason: "already_registered" };
  }
  const theme = themeRefusal(booker, evening);
  if (theme) return { ok: false, reason: theme };
  return { ok: true, outcome: seatsLeft(evening, registrations, booker.sex) > 0 ? "seat" : "waitlist" };
}

/** Liste d'attente d'un sexe, dans l'ordre d'arrivée. */
export function waitlist(registrations: Registration[], sex: Sex): Registration[] {
  return registrations
    .filter((r) => r.sex === sex && r.status === "waitlisted")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Le membre peut confirmer sa place jusqu'à la limite de 48 h. */
export function canConfirm(registration: Registration, evening: Evening, now: Date): boolean {
  return registration.status === "booked" && now < confirmationDeadline(evening.startsAt);
}

/**
 * Attribue les places libres aux premiers de la liste d'attente, sexe par sexe.
 * Renvoie une nouvelle liste ; les inscriptions promues ont le statut « booked ».
 */
export function promoteWaitlist(evening: Evening, registrations: Registration[], now: Date): Registration[] {
  const next = registrations.map((r) => ({ ...r }));
  for (const sex of ["female", "male"] as const) {
    let free = seatsLeft(evening, next, sex);
    for (const candidate of waitlist(next, sex)) {
      if (free <= 0) break;
      candidate.status = "booked";
      candidate.seatedAt = now;
      free -= 1;
    }
  }
  return next;
}

/**
 * Passage de la limite des 48 h : les places réservées avant la limite et non confirmées
 * sont libérées, puis attribuées à la liste d'attente.
 * Une place attribuée après la limite n'est pas libérée ici : le délai de confirmation
 * dans ce cas reste à définir (question ouverte, propositions/PHASE2.txt).
 */
export function releaseUnconfirmed(evening: Evening, registrations: Registration[], now: Date): Registration[] {
  const deadline = confirmationDeadline(evening.startsAt);
  if (now < deadline) return registrations.map((r) => ({ ...r }));
  const released = registrations.map((r) =>
    r.status === "booked" && (r.seatedAt ?? r.createdAt) < deadline ? { ...r, status: "released" as const } : { ...r },
  );
  return promoteWaitlist(evening, released, now);
}

/** Annulation par le membre : sa place va au premier de la liste d'attente du même sexe. */
export function cancelRegistration(evening: Evening, registrations: Registration[], memberId: string, now: Date) {
  const next = registrations.map((r) => (r.memberId === memberId && isActive(r) ? { ...r, status: "cancelled" as const } : { ...r }));
  return promoteWaitlist(evening, next, now);
}
