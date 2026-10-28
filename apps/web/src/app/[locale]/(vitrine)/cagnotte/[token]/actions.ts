"use server";

import { type ApiResult, publicApi } from "@/lib/api";
import { amountOf, checkContribution, type ContributionInput } from "@/lib/cagnotte";

const TOKEN = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ContributionStart = { paymentId: string; provider: "simulated" | "feexpay" };
export type ContributionPay = { status: "succeeded" | "pending" | "failed"; reason?: string };

/** Contribution sans compte (phase 4, question 3 b) : l'API et la base revérifient tout. */
export async function startContribution(token: string, input: ContributionInput, minXof: number): Promise<ApiResult<ContributionStart>> {
  if (!TOKEN.test(token)) return { ok: false, error: "not_found" };
  const invalid = checkContribution(input, minXof);
  if (invalid) return { ok: false, error: invalid };
  return publicApi<ContributionStart>(`/cagnottes/${token}/contributions`, {
    method: "POST",
    body: {
      name: input.anonymous ? null : input.name.trim(),
      anonymous: input.anonymous,
      message: input.message.trim() || null,
      amountXof: amountOf(input.amount),
      hideAmount: input.hideAmount,
    },
  });
}

/** Paiement par Mobile Money (FeexPay) : la demande arrive sur le téléphone du contributeur. */
export async function payContribution(paymentId: string, network: string, phone: string): Promise<ApiResult<ContributionPay>> {
  if (!UUID.test(paymentId) || !["mtn", "moov", "celtiis"].includes(network)) return { ok: false, error: "generic" };
  return publicApi<ContributionPay>(`/cagnottes/contributions/${paymentId}/mobile`, { method: "POST", body: { network, phone } });
}

/** Vérification de la demande en cours, relue chez FeexPay par l'API. */
export async function refreshContribution(paymentId: string): Promise<ApiResult<ContributionPay>> {
  if (!UUID.test(paymentId)) return { ok: false, error: "generic" };
  return publicApi<ContributionPay>(`/cagnottes/contributions/${paymentId}/refresh`, { method: "POST" });
}

/** Démonstration : contribution simulée validée (refusé par l'API en production). */
export async function succeedSimulatedContribution(paymentId: string): Promise<ApiResult<void>> {
  if (!UUID.test(paymentId)) return { ok: false, error: "generic" };
  return publicApi<void>(`/cagnottes/contributions/${paymentId}/simulated`, { method: "POST" });
}
