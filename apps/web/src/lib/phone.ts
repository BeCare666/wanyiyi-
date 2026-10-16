/** Numéro au format international (E.164) : +, indicatif du pays, 8 à 15 chiffres au total. */
export function normalizePhone(input: string): string | null {
  const compact = input.replace(/[\s.()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}
