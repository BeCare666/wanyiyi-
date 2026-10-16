"use server";

import { type ApiResult, memberApi } from "@/lib/api";
import { isQrToken, type Partner, parseVote, type VoteInput } from "./vote";

/** Personne rencontrée à ce tour (prénom et table) et vote déjà donné. */
export async function loadPartner(qr: string, round: number): Promise<ApiResult<Partner | null>> {
  if (!isQrToken(qr) || !Number.isInteger(round) || round < 1) return { ok: false, error: "generic" };
  return memberApi<Partner | null>(`/vote/${qr}/rounds/${round}`);
}

/** Enregistre ou modifie le vote du tour (l'appréciation facultative reste réservée à l'équipe). */
export async function saveVote(qr: string, round: number, input: VoteInput): Promise<ApiResult<void>> {
  const body = parseVote(input);
  if (!isQrToken(qr) || !Number.isInteger(round) || round < 1 || !body) return { ok: false, error: "generic" };
  return memberApi<void>(`/vote/${qr}/rounds/${round}`, { method: "POST", body });
}
