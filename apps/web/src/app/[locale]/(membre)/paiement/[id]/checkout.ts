/** Paiement lu par la page (GET /api/payments/:id) : montant, état, réglages publics du widget. */
export type CheckoutInfo = {
  paymentId: string;
  purpose: string;
  amountXof: number;
  status: "pending" | "succeeded" | "failed" | "refunded" | "cancelled";
  provider: string;
  widget: { publicKey: string; sandbox: boolean } | null;
};

/** Options du widget KkiaPay (noms acceptés par cdn.kkiapay.me/k.js). */
export type WidgetOptions = { amount: number; key: string; sandbox: boolean; partnerId: string };

/**
 * Options d'ouverture du widget : montant exact du paiement, clé publique, mode test, et l'identifiant
 * du paiement en partnerId (l'API le compare à la transaction vérifiée). null si rien n'est à payer.
 */
export function widgetOptions(info: CheckoutInfo): WidgetOptions | null {
  if (info.status !== "pending" || info.provider !== "kkiapay" || !info.widget) return null;
  return { amount: info.amountXof, key: info.widget.publicKey, sandbox: info.widget.sandbox, partnerId: info.paymentId };
}

/** Référence de transaction renvoyée par le widget après un paiement réussi, ou null. */
export function transactionIdOf(response: unknown): string | null {
  const id = (response as { transactionId?: unknown } | null)?.transactionId;
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/**
 * Erreurs après lesquelles le membre vérifie de nouveau la même transaction (KkiaPay injoignable
 * ou transaction pas encore visible) au lieu de rouvrir le widget et de payer deux fois.
 */
export function canRetryVerification(error: string): boolean {
  return error === "kkiapay_unavailable" || error === "transaction_not_found";
}
