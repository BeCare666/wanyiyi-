"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { fromCotonouInput } from "../soirees/evenings";
import { type BulkMessage, type BulkTarget, checkMessage, targetArgs } from "./bulk";
import { type FilterGroup, formatSort, isBuilderFilter, type MemberColumn, parseColumns, parseSort, type SortKey } from "./filters";
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

/**
 * Enregistrement du filtre courant (11.3), personnel ou partagé avec l'équipe des membres.
 * La base contrôle à nouveau le filtre, le tri et les colonnes (app.check_saved_filter).
 */
export async function saveFilter(input: {
  name: string;
  shared: boolean;
  definition: FilterGroup;
  sort: SortKey[];
  columns: MemberColumn[];
}): Promise<ApiResult<{ id: string }>> {
  const name = input.name.trim();
  if (name === "" || name.length > 80) return { ok: false, error: "name_required" };
  if (!isBuilderFilter(input.definition)) return { ok: false, error: "invalid_filter" };
  // Tri et colonnes ramenés aux valeurs permises
  const sort = parseSort(formatSort(input.sort));
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "forbidden" };
  const { data, error } = await supabase
    .from("saved_filters")
    .insert({
      owner_id: auth.user.id,
      resource: "members",
      name,
      definition: input.definition,
      sort: sort.length > 0 ? sort : null,
      columns: parseColumns(input.columns.join(",")),
      shared: input.shared,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data.id as string } };
}

/** Suppression d'un filtre enregistré (les siens seulement, contrôlé par la RLS). */
export async function deleteFilter(id: string): Promise<ApiResult<void>> {
  if (!UUID.test(id)) return { ok: false, error: "generic" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.from("saved_filters").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  return data && data.length > 0 ? { ok: true, data: undefined } : { ok: false, error: "forbidden" };
}

/** Envoi d'une notification écrite en trois langues (app.admin_notify_members). */
export async function bulkNotify(target: BulkTarget, message: BulkMessage): Promise<ApiResult<{ recipients: number }>> {
  const args = targetArgs(target);
  if (!args) return { ok: false, error: "invalid_targets" };
  const invalid = checkMessage(message);
  if (invalid) return { ok: false, error: invalid };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.rpc("admin_notify_members", {
    ...args,
    p_body: { fr: message.fr.trim(), en: message.en.trim(), yo: message.yo.trim() },
  });
  return error ? { ok: false, error: error.message } : { ok: true, data: { recipients: data as number } };
}

/** Invitation à une soirée publiée à venir (app.admin_invite_members) : membres validés seulement. */
export async function bulkInvite(target: BulkTarget, eventId: string): Promise<ApiResult<{ invited: number; skipped: number }>> {
  const args = targetArgs(target);
  if (!args) return { ok: false, error: "invalid_targets" };
  if (!UUID.test(eventId)) return { ok: false, error: "not_found" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.rpc("admin_invite_members", { ...args, p_event: eventId });
  if (error) return { ok: false, error: error.message };
  const [counts] = (data ?? []) as Array<{ invited: number; skipped: number }>;
  return { ok: true, data: counts ?? { invited: 0, skipped: 0 } };
}
