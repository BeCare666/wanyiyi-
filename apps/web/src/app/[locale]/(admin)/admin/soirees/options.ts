import { createSupabaseServer } from "@/lib/supabase/server";
import type { ThemeOption, VenueOption } from "./EventForm";

/** Lieux et thèmes proposés dans le formulaire (lecture permise par events.manage). */
export async function loadEventOptions(): Promise<{ venues: VenueOption[]; themes: ThemeOption[] }> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { venues: [], themes: [] };
  const [venues, themes] = await Promise.all([
    supabase.from("venues").select("id, name, city").order("name"),
    supabase.from("themes").select("id, key, min_age, max_age").order("key"),
  ]);
  return { venues: (venues.data as VenueOption[] | null) ?? [], themes: (themes.data as ThemeOption[] | null) ?? [] };
}
