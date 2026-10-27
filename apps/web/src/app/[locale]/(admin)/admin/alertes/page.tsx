import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { cn } from "@/lib/cn";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { HandleButton } from "./HandleButton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("alerts") };
}

type Alert = {
  checkin_id: string;
  user_id: string;
  first_name: string | null;
  member_number: string | null;
  phone: string | null;
  answer: "help" | null;
  date_at: string;
  alerted_at: string;
  handled_at: string | null;
};

/**
 * Alertes de sécurité (question 5) : membres qui ont répondu « J'ai besoin d'aide » à « Bien
 * rentré(e) ? », ou qui n'ont pas répondu 24 heures après leur rendez-vous. Les alertes à traiter
 * d'abord. Permission couples.manage.
 */
export default async function AlertsPage() {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("couples.manage")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const supabase = await createSupabaseServer();
  const result = supabase ? await supabase.rpc("admin_safety_alerts") : null;
  const alerts = (result?.data ?? []) as Alert[];
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Porto-Novo" });

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.relations")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.alerts")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("alerts.intro")}</p>
      </header>

      {!result || result.error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : alerts.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("alerts.empty")}</p>
      ) : (
        <ol className="mt-10 border-t border-line">
          {alerts.map((a) => (
            <li
              key={`${a.checkin_id}-${a.user_id}`}
              className={cn("grid gap-3 border-b border-line py-6 md:grid-cols-12 md:items-center md:gap-8", a.handled_at && "text-fg-muted")}
            >
              <div className="md:col-span-4">
                <p className="font-medium">{[a.first_name, a.member_number].filter(Boolean).join(" · ")}</p>
                {a.phone && (
                  <a href={`tel:${a.phone}`} className="text-link underline-offset-4 hover:underline">
                    {a.phone}
                  </a>
                )}
              </div>
              <p className="md:col-span-4">
                <span className={cn("block", a.answer === "help" && !a.handled_at && "font-medium")}>
                  {a.answer === "help" ? t("alerts.help") : t("alerts.noAnswer")}
                </span>
                <span className="block text-sm text-fg-muted">{t("alerts.dateAt", { date: when(a.date_at) })}</span>
              </p>
              <div className="text-sm md:col-span-4 md:text-right">
                {a.handled_at ? t("alerts.handled", { date: when(a.handled_at) }) : <HandleButton checkinId={a.checkin_id} userId={a.user_id} />}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
