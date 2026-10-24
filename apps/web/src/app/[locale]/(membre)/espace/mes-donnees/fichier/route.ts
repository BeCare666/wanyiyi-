import { createSupabaseServer } from "@/lib/supabase/server";
import { cotonouDay } from "../../../../(admin)/admin/membres/filters";
import { dataFileName } from "../data";

/**
 * Téléchargement de mes données en JSON (question 16) : app.my_data() lue avec le jeton du membre,
 * qui ne rend que ses propres données. Pas de cache.
 */
export async function GET() {
  const supabase = await createSupabaseServer();
  if (!supabase) return new Response(null, { status: 503 });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return new Response(null, { status: 401 });
  const { data, error } = await supabase.rpc("my_data");
  if (error || !data) return new Response(null, { status: 500 });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${dataFileName(cotonouDay(new Date()))}"`,
      "Cache-Control": "no-store",
    },
  });
}
