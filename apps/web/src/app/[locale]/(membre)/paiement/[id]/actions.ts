"use server";

import { type ApiResult, memberApi } from "@/lib/api";
import { type CardHolder, cardError, isBeninPhone, isMethod, type PayResult } from "./checkout";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paiement Mobile Money : l'API envoie la demande au téléphone du membre par FeexPay. */
export async function payByMobile(paymentId: string, network: string, phone: string): Promise<ApiResult<PayResult>> {
  if (!UUID.test(paymentId) || !isMethod(network) || network === "card") return { ok: false, error: "generic" };
  if (!isBeninPhone(phone)) return { ok: false, error: "invalid_phone" };
  return memberApi<PayResult>(`/payments/${paymentId}/feexpay/mobile`, { method: "POST", body: { network, phone } });
}

/** Paiement par carte : l'API renvoie la page de paiement FeexPay. */
export async function payByCard(paymentId: string, holder: CardHolder): Promise<ApiResult<PayResult>> {
  if (!UUID.test(paymentId)) return { ok: false, error: "generic" };
  if (cardError(holder)) return { ok: false, error: "invalid_card_holder" };
  return memberApi<PayResult>(`/payments/${paymentId}/feexpay/card`, { method: "POST", body: holder });
}

/** Vérification de la demande en cours : l'API relit son statut chez FeexPay. */
export async function refreshPayment(paymentId: string): Promise<ApiResult<PayResult>> {
  if (!UUID.test(paymentId)) return { ok: false, error: "generic" };
  return memberApi<PayResult>(`/payments/${paymentId}/feexpay/refresh`, { method: "POST" });
}
