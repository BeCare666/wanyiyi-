"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { type Decision, decisions } from "./reports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReportedMessage = { id: string; sender_first_name: string | null; body: string; created_at: string };

/** Messages signalés seulement (reports.read) ; chaque consultation est journalisée par la base. */
export async function loadReportedMessages(reportId: string): Promise<ApiResult<ReportedMessage[]>> {
  if (!UUID.test(reportId)) return { ok: false, error: "generic" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.rpc("admin_reported_messages", { p_report: reportId });
  return error ? { ok: false, error: error.message } : { ok: true, data: (data ?? []) as ReportedMessage[] };
}

/**
 * Décision (reports.manage) : classement, avertissement, suspension ou exclusion. Le motif, neutre,
 * est notifié à la personne signalée (obligatoire sauf classement).
 */
export async function resolveReport(reportId: string, decision: Decision, reason: string): Promise<ApiResult<void>> {
  if (!UUID.test(reportId) || !decisions.includes(decision) || typeof reason !== "string") return { ok: false, error: "generic" };
  if (decision !== "dismissed" && reason.trim() === "") return { ok: false, error: "reason_required" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("admin_resolve_report", { p_report: reportId, p_decision: decision, p_reason: reason.trim().slice(0, 1000) || null });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}
