"use server";

import { type ApiResult, memberApi } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { checkDraft, type EventDraft, type EveningStep, fromCotonouInput } from "./evenings";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Création ou modification d'une soirée, brouillon ou publiée (19 octobre 2026). La permission
 * events.manage et les règles (capacité 12 × 12, début futur, pas sous les places prises,
 * tables non préparées) sont contrôlées par app.save_event.
 */
export async function saveEvent(eventId: string | null, draft: EventDraft): Promise<ApiResult<{ id: string }>> {
  if (eventId !== null && !UUID.test(eventId)) return { ok: false, error: "generic" };
  if ((draft.venueId && !UUID.test(draft.venueId)) || (draft.themeId && !UUID.test(draft.themeId))) return { ok: false, error: "generic" };
  const invalid = checkDraft(draft, new Date());
  if (invalid) return { ok: false, error: invalid };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { data, error } = await supabase.rpc("save_event", {
    p_event: eventId,
    p_venue: draft.venueId || null,
    p_theme: draft.themeId || null,
    p_starts_at: fromCotonouInput(draft.startsAt)!.toISOString(),
    p_capacity_women: draft.capacityWomen,
    p_capacity_men: draft.capacityMen,
    p_round_minutes: draft.roundMinutes,
    p_changeover_minutes: draft.changeoverMinutes,
    p_price_xof: draft.priceXof,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data as string } };
}

/** Suppression d'un brouillon (app.delete_draft_event). */
export async function deleteDraft(eventId: string): Promise<ApiResult<void>> {
  if (!UUID.test(eventId)) return { ok: false, error: "generic" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("delete_draft_event", { p_event: eventId });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}

/**
 * Étape suivante du déroulé. La publication passe par la base ; le reste par l'API
 * (pilotage de soirée, jeton transmis), qui appelle les fonctions de la migration 20261014000000.
 */
export async function runStep(eventId: string, step: EveningStep): Promise<ApiResult<void>> {
  if (!UUID.test(eventId)) return { ok: false, error: "generic" };
  if (step === "publish") {
    const supabase = await createSupabaseServer();
    if (!supabase) return { ok: false, error: "unavailable" };
    const { error } = await supabase.rpc("publish_event", { p_event: eventId });
    return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
  }
  const path = { prepare: "prepare", start: "start", finish: "finish", compute: "compute-matches" }[step];
  if (!path) return { ok: false, error: "generic" };
  const result = await memberApi<unknown>(`/admin/events/${eventId}/${path}`, { method: "POST" });
  return result.ok ? { ok: true, data: undefined } : result;
}

/** Pointage à l'entrée d'un participant confirmé (API, puis app.check_in). */
export async function checkIn(eventId: string, userId: string): Promise<ApiResult<void>> {
  if (!UUID.test(eventId) || !UUID.test(userId)) return { ok: false, error: "generic" };
  return memberApi<void>(`/admin/events/${eventId}/check-in/${userId}`, { method: "POST" });
}

/**
 * Annulation d'une soirée publiée (API, puis app.cancel_event) : places annulées, inscrits
 * notifiés, paiements reçus remboursés en entier par l'adaptateur de paiement.
 */
export async function cancelEvening(eventId: string): Promise<ApiResult<{ refunds: number }>> {
  if (!UUID.test(eventId)) return { ok: false, error: "generic" };
  return memberApi<{ refunds: number }>(`/admin/events/${eventId}/cancel`, { method: "POST" });
}

/** Démarrage du minuteur de la tablette (question 8) : horaire des tours fixé par la base, sans pause. */
export async function startTimer(eventId: string): Promise<ApiResult<void>> {
  if (!UUID.test(eventId)) return { ok: false, error: "generic" };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase.rpc("start_timer", { p_event: eventId });
  return error ? { ok: false, error: error.message } : { ok: true, data: undefined };
}
