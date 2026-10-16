"use server";

import { type ApiResult, memberApi } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lien signé de 5 minutes vers une pièce ou un selfie. L'API fait vérifier la permission
 * par la base, qui journalise l'ouverture, puis crée le lien.
 */
export async function openDocument(documentId: string): Promise<ApiResult<{ url: string; expiresIn: number }>> {
  if (!UUID.test(documentId)) return { ok: false, error: "generic" };
  return memberApi(`/admin/verifications/documents/${documentId}/link`, { method: "POST" });
}

export type Decision = "approved" | "to_correct" | "rejected";

/** Décision sur un dossier : contrôlée par app.decide_verification (permission, dossier complet, message). */
export async function decide(verificationId: string, status: Decision, note: string): Promise<ApiResult<void>> {
  if (!UUID.test(verificationId) || !["approved", "to_correct", "rejected"].includes(status)) return { ok: false, error: "generic" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("decide_verification", { p_verification: verificationId, p_status: status, p_note: note.trim() || null });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}
