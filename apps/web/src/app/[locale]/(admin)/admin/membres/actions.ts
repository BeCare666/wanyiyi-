"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { fromCotonouInput } from "../soirees/evenings";
import { type Role, roles } from "./members";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Appel d'une fonction d'équipe avec le jeton de la personne : permissions et règles contrôlées par la base. */
async function call(fn: string, args: Record<string, unknown>): Promise<ApiResult<void>> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc(fn, args);
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}

/** Suspension avec motif (notifié au membre). */
export async function suspendMember(userId: string, reason: string): Promise<ApiResult<void>> {
  if (!UUID.test(userId)) return { ok: false, error: "generic" };
  if (reason.trim() === "") return { ok: false, error: "reason_required" };
  return call("suspend_member", { p_user: userId, p_reason: reason.trim().slice(0, 1000) });
}

export async function reactivateMember(userId: string): Promise<ApiResult<void>> {
  if (!UUID.test(userId)) return { ok: false, error: "generic" };
  return call("reactivate_member", { p_user: userId });
}

/** Exclusion définitive avec motif (notifié au membre). */
export async function excludeMember(userId: string, reason: string): Promise<ApiResult<void>> {
  if (!UUID.test(userId)) return { ok: false, error: "generic" };
  if (reason.trim() === "") return { ok: false, error: "reason_required" };
  return call("exclude_member", { p_user: userId, p_reason: reason.trim().slice(0, 1000) });
}

/** Blocage des soirées jusqu'à une date saisie à l'heure de Cotonou ; vide : levée du blocage. */
export async function blockEvenings(userId: string, until: string): Promise<ApiResult<void>> {
  if (!UUID.test(userId)) return { ok: false, error: "generic" };
  if (until.trim() === "") return call("block_member_evenings", { p_user: userId, p_until: null });
  const date = fromCotonouInput(until);
  if (!date) return { ok: false, error: "date_invalid" };
  return call("block_member_evenings", { p_user: userId, p_until: date.toISOString() });
}

/** Changement de rôle (super administration ; jamais le sien). */
export async function setRole(userId: string, role: Role): Promise<ApiResult<void>> {
  if (!UUID.test(userId) || !roles.includes(role)) return { ok: false, error: "generic" };
  return call("set_member_role", { p_user: userId, p_role: role });
}
