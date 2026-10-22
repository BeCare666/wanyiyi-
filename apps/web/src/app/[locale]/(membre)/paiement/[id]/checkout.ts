/** Paiement lu par la page (GET /api/payments/:id) : montant, état, moyens proposés par FeexPay. */
export type CheckoutInfo = {
  paymentId: string;
  purpose: string;
  amountXof: number;
  status: "pending" | "succeeded" | "failed" | "refunded" | "cancelled";
  provider: string;
  feexpay: { sandbox: boolean; networks: Network[]; awaiting: boolean } | null;
};

/** Réseaux Mobile Money du Bénin retenus le 22 octobre 2026 (question 29). */
export const networks = ["mtn", "moov", "celtiis"] as const;
export type Network = (typeof networks)[number];

/** Moyen choisi par le membre : un réseau Mobile Money, ou la carte (page FeexPay). */
export type Method = Network | "card";
export const methods: readonly Method[] = [...networks, "card"];

export function isMethod(value: string): value is Method {
  return (methods as readonly string[]).includes(value);
}

/** Moyens proposés pour ce paiement, ou null s'il n'y a rien à payer par FeexPay. */
export function methodsOf(info: CheckoutInfo): Method[] | null {
  if (info.status !== "pending" || info.provider !== "feexpay" || !info.feexpay) return null;
  return [...info.feexpay.networks.filter((n) => (networks as readonly string[]).includes(n)), "card"];
}

/**
 * Numéro béninois à 10 chiffres (01 et 8 chiffres), avec ou sans l'indicatif 229 : contrôle
 * avant l'envoi, la même règle est appliquée par l'API.
 */
export function isBeninPhone(input: string): boolean {
  const digits = input.replace(/[\s.\-()+]/g, "");
  if (!/^\d+$/.test(digits)) return false;
  return /^01\d{8}$/.test(digits.startsWith("229") ? digits.slice(3) : digits);
}

/** Coordonnées du titulaire de la carte, exigées par FeexPay. */
export type CardHolder = { firstName: string; lastName: string; email: string; phoneNumber: string; city: string; zip: string };
export const cardFields = ["firstName", "lastName", "email", "phoneNumber", "city", "zip"] as const satisfies readonly (keyof CardHolder)[];

/** Premier champ incorrect du formulaire carte, ou null. */
export function cardError(holder: CardHolder): keyof CardHolder | null {
  for (const field of cardFields) if (holder[field].trim() === "") return field;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(holder.email.trim())) return "email";
  if (!isBeninPhone(holder.phoneNumber)) return "phoneNumber";
  return null;
}

/** Réponse de l'API après une demande ou une vérification. */
export type PayResult = { status: "succeeded" | "pending" | "failed"; reason?: string; paymentUrl?: string | null };

