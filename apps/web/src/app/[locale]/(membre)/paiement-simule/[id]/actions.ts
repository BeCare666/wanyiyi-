"use server";

import { type ApiResult, memberApi } from "@/lib/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Démonstration : valide le paiement simulé (refusé par l'API en production). */
export async function succeedSimulatedPayment(paymentId: string): Promise<ApiResult<void>> {
  if (!UUID.test(paymentId)) return { ok: false, error: "generic" };
  return memberApi(`/payments/simulated/${paymentId}/succeed`, { method: "POST" });
}
