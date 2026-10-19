import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { type AdminEventRow, eventFilters, filterEvents, parseEventFilter } from "./evenings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("evenings") };
}

type Props = { searchParams: Promise<{ etat?: string | string[] }> };

/**
 * Liste des soirées (section 11.2-5), brouillons compris, les plus récentes d'abord :
 * remplissage par sexe, liste d'attente, matchs. Réservée à la permission events.manage.
 */
export default async function AdminEveningsPage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("events.manage")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const filter = parseEventFilter((await searchParams).etat);
  const supabase = await createSupabaseServer();
  const result = supabase ? await supabase.rpc("admin_events") : null;
  const rows = filterEvents((result?.data ?? []) as AdminEventRow[], filter);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">{t("groups.evenings")}</p>
          <h1 className="mt-4 text-4xl">{t("nav.evenings")}</h1>
          <p className="mt-4 max-w-measure text-fg-muted">{t("evenings.intro")}</p>
        </div>
        <Link
          href="/admin/soirees/nouvelle"
          className="inline-flex min-h-12 items-center rounded-sm bg-accent px-7 text-xs font-medium uppercase tracking-[0.16em] text-accent-fg"
        >
          {t("evenings.new")}
        </Link>
      </header>

      <nav aria-label={t("evenings.filters.label")} className="mt-10 flex flex-wrap gap-2">
        {eventFilters.map(({ key, query }) => (
          <Link
            key={key}
            href={query ? { pathname: "/admin/soirees", query: { etat: query } } : "/admin/soirees"}
            aria-current={filter === key ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center rounded-sm border px-4 text-sm",
              filter === key ? "border-fg bg-fg text-bg" : "border-line text-fg hover:border-fg",
            )}
          >
            {t(`evenings.filters.${key}`)}
          </Link>
        ))}
      </nav>

      {!result || result.error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("evenings.empty")}</p>
      ) : (
        <table className="mt-10 w-full border-collapse text-left text-sm">
          <caption className="sr-only">{t("nav.evenings")}</caption>
          <thead className="hidden border-b border-line-strong md:table-header-group">
            <tr>
              <th scope="col" className="py-3 pr-4 font-medium">{t("evenings.columns.date")}</th>
              <th scope="col" className="py-3 pr-4 font-medium">{t("evenings.columns.status")}</th>
              <th scope="col" className="py-3 pr-4 font-medium">{t("evenings.columns.women")}</th>
              <th scope="col" className="py-3 pr-4 font-medium">{t("evenings.columns.men")}</th>
              <th scope="col" className="py-3 font-medium md:text-right">{t("evenings.columns.matches")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                <th scope="row" className="font-normal md:py-4 md:pr-4">
                  <Link href={`/admin/soirees/${row.id}`} className="font-medium underline-offset-4 hover:underline">
                    {format.dateTime(new Date(row.starts_at), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                  </Link>
                  <span className="block text-fg-muted">
                    {row.venue_name ?? t("evenings.noVenue")}
                    {row.theme_key && ` · ${row.theme_key}`}
                  </span>
                </th>
                <td className="md:py-4 md:pr-4">{t(`evenings.status.${row.status}`)}</td>
                <td className="tabular-nums md:py-4 md:pr-4">
                  <span className="md:sr-only">{t("evenings.cellLabel", { label: t("evenings.columns.women") })} </span>
                  {t("evenings.fill", { taken: row.taken_women, capacity: row.capacity_women })}
                  {row.waiting_women > 0 && <span className="text-fg-muted"> · {t("evenings.waiting", { count: row.waiting_women })}</span>}
                </td>
                <td className="tabular-nums md:py-4 md:pr-4">
                  <span className="md:sr-only">{t("evenings.cellLabel", { label: t("evenings.columns.men") })} </span>
                  {t("evenings.fill", { taken: row.taken_men, capacity: row.capacity_men })}
                  {row.waiting_men > 0 && <span className="text-fg-muted"> · {t("evenings.waiting", { count: row.waiting_men })}</span>}
                </td>
                <td className="tabular-nums text-fg-muted md:py-4 md:text-right">
                  <span className="md:sr-only">{t("evenings.cellLabel", { label: t("evenings.columns.matches") })} </span>
                  {row.matches}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
