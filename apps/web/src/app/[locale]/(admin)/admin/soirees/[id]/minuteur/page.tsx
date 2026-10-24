import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { TimerRound } from "../../timer";
import { EveningTimer } from "./EveningTimer";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.evenings.timer");
  return { title: t("title") };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Minuteur de la soirée sur tablette (note : « pilote les tours, signal visuel et sonore » ;
 * question 8 du 22 octobre 2026 : pas de pause). Permission events.manage, contrôlée par la base.
 */
export default async function EveningTimerPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("events.manage")) notFound();
  const t = await getTranslations("Admin.evenings.timer");
  const supabase = await createSupabaseServer();
  if (!supabase) notFound();
  const { data: event } = await supabase.from("events").select("id, status").eq("id", id).maybeSingle();
  if (!event) notFound();
  const { data } = await supabase.rpc("evening_timer", { p_event: id });
  const rounds = (data ?? []) as TimerRound[];

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/admin/soirees/${id}`} className="text-sm text-link underline-offset-4 hover:underline">
        {t("back")}
      </Link>
      <h1 className="mt-6 text-4xl">{t("title")}</h1>
      <p className="mt-4 max-w-measure text-fg-muted">{t("help")}</p>
      <EveningTimer eventId={id} rounds={rounds} canStart={event.status === "in_progress" && rounds.length > 0} />
    </div>
  );
}
