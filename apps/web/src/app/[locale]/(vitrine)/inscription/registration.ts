import { isEmail } from "../../(membre)/espace/parametres/settings";

/**
 * Identité déclarée à l'inscription (section 6.2-2), mêmes règles que app.complete_registration :
 * 18 ans révolus au jour de Cotonou, sans âge maximum (décision du 19 octobre 2026) ;
 * adresse e-mail facultative (décision du 19 octobre 2026).
 */

export const MINIMUM_AGE = 18;

export type Identity = {
  firstName: string;
  lastName: string;
  sex: "female" | "male" | "";
  birthDate: string;
  city: string;
  email: string;
  consent: boolean;
};

export type IdentityError =
  | "invalid_name"
  | "invalid_sex"
  | "invalid_birth_date"
  | "too_young"
  | "invalid_city"
  | "invalid_email"
  | "consent_required";

/** Jour de Cotonou (UTC+1, sans heure d'été) au format AAAA-MM-JJ. */
function cotonouDay(now: Date): string {
  return new Date(now.getTime() + 3600_000).toISOString().slice(0, 10);
}

/** Âge révolu au jour de Cotonou. */
export function ageOnCotonouDay(birthDate: string, now: Date): number {
  const [y, m, d] = cotonouDay(now).split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Dernière date de naissance permise (le jour des 18 ans), pour la borne du champ date. */
export function latestBirthDate(now: Date): string {
  const [y, m, d] = cotonouDay(now).split("-") as [string, string, string];
  // Né un 29 février : 18 ans révolus le 1er mars d'une année non bissextile
  const candidate = `${Number(y) - MINIMUM_AGE}-${m}-${d}`;
  return isRealDate(candidate) ? candidate : `${Number(y) - MINIMUM_AGE}-02-28`;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Première erreur de saisie, ou null si l'identité peut être envoyée. */
export function checkIdentity(identity: Identity, now: Date): IdentityError | null {
  const first = identity.firstName.trim();
  const last = identity.lastName.trim();
  if (first.length < 1 || first.length > 60 || last.length < 1 || last.length > 60) return "invalid_name";
  if (identity.sex !== "female" && identity.sex !== "male") return "invalid_sex";
  if (!isRealDate(identity.birthDate) || identity.birthDate < "1900-01-01" || identity.birthDate > cotonouDay(now)) return "invalid_birth_date";
  if (ageOnCotonouDay(identity.birthDate, now) < MINIMUM_AGE) return "too_young";
  if (identity.city.trim().length > 80) return "invalid_city";
  const email = identity.email.trim();
  if (email !== "" && !isEmail(email)) return "invalid_email";
  if (!identity.consent) return "consent_required";
  return null;
}
