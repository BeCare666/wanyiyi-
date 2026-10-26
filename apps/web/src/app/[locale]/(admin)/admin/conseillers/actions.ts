"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { checkCounselor, type CounselorInput, counselorParams } from "./counselors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Création d'un conseiller à partir du compte d'un membre, désigné par son numéro de membre
 * (question 9 a). La base contrôle la permission counselors.manage, le rôle de départ
 * (membre seulement) et journalise.
 */
export async function createCounselor(memberNumber: string, input: CounselorInput): Promise<ApiResult<void>> {
  const invalid = checkCounselor(input);
  if (invalid) return { ok: false, error: invalid };
  const number = memberNumber.trim();
  if (number === "") return { ok: false, error: "not_found" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data: user } = await supabase.from("users").select("id").eq("member_number", number).maybeSingle();
  if (!user) return { ok: false, error: "not_found" };
  const { error } = await supabase.rpc("admin_create_counselor", { p_user: user.id, ...counselorParams(input) });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}

/** Modification : nom affiché, présentation, langues, nombre maximal de couples, disponibilité. */
export async function updateCounselor(userId: string, input: CounselorInput, available: boolean): Promise<ApiResult<void>> {
  if (!UUID.test(userId) || typeof available !== "boolean") return { ok: false, error: "generic" };
  const invalid = checkCounselor(input);
  if (invalid) return { ok: false, error: invalid };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("admin_update_counselor", { p_user: userId, ...counselorParams(input), p_available: available });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}

/**
 * Attribution d'un conseiller à un couple dont les deux membres ont accepté l'invitation
 * (question 9, réponse du 26 octobre 2026 : l'administration attribue le conseiller). La base
 * vérifie l'accord des deux, la disponibilité et la charge du conseiller, et journalise.
 */
export async function assignCounselor(accessId: string, counselorId: string): Promise<ApiResult<void>> {
  if (!UUID.test(accessId) || !UUID.test(counselorId)) return { ok: false, error: "generic" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("admin_assign_counselor", { p_access: accessId, p_counselor: counselorId });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}
