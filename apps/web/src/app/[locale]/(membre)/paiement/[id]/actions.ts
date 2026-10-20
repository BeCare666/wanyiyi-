"use server";

import { type ApiResult, memberApi } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSACTION = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Fin du paiement dans le widget KkiaPay : l'API relit la transaction chez KkiaPay avec ses clés
 * privées avant de marquer le paiement réussi (jamais sur la seule parole du navigateur).
 */
export async function confirmKkiapayPayment(paymentId: string, transactionId: string): Promise<ApiResult<{ status: string }>> {
  if (!UUID.test(paymentId) || !TRANSACTION.test(transactionId)) return { ok: false, error: "generic" };
  return memberApi<{ status: string }>(`/payments/${paymentId}/kkiapay`, { method: "POST", body: { transactionId } });
}
