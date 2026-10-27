"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { checkFirstDate, checkVenue, type FirstDateInput, type VenueInput } from "./venues";

/**
 * Nouveau lieu. Écriture permise par la politique RLS venues_manage (permission events.manage).
 * L'adresse n'est communiquée qu'aux participants confirmés (venues_select_confirmed).
 */
export async function createVenue(input: VenueInput): Promise<ApiResult<void>> {
  const invalid = checkVenue(input);
  if (invalid) return { ok: false, error: invalid };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase
    .from("venues")
    .insert({ name: input.name.trim(), address: input.address.trim(), city: input.city.trim(), is_partner: input.isPartner });
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  return { ok: true, data: undefined };
}

/** Lieu conseillé pour un premier rendez-vous (question 4) : case, quartier, type, horaires. */
export async function updateFirstDate(venueId: string, input: FirstDateInput): Promise<ApiResult<void>> {
  if (!/^[0-9a-f-]{36}$/i.test(venueId)) return { ok: false, error: "generic" };
  const invalid = checkFirstDate(input);
  if (invalid) return { ok: false, error: invalid };
  const supabase = await createSupabaseServer();
  if (!supabase) return { ok: false, error: "unavailable" };
  const { error } = await supabase
    .from("venues")
    .update({
      first_date_partner: input.partner,
      district: input.district.trim() || null,
      venue_kind: input.kind || null,
      opening_hours: input.hours.trim() || null,
    })
    .eq("id", venueId);
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  return { ok: true, data: undefined };
}
