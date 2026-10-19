"use server";

import type { ApiResult } from "@/lib/api";
import { createSupabaseServer } from "@/lib/supabase/server";
import { checkVenue, type VenueInput } from "./venues";

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
