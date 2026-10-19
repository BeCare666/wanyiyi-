import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { Link } from "@/i18n/navigation";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { isQrToken } from "@/app/[locale]/(membre)/vote/[qr]/vote";
import type { EventStatus } from "../../evenings";
import { canPrintTables, qrPath, voteUrl } from "../../tables";
import { PrintButton } from "./PrintButton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.evenings.tables");
  return { title: t("title") };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TableRow = { table_number: number; qr_token: string };

/** Lecture avec le jeton de la personne : la permission events.manage est contrôlée par la base. */
async function loadTables(id: string) {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;
  const { data: event } = await supabase.from("events").select("id, starts_at, status, venue:venues(name)").eq("id", id).maybeSingle();
  if (!event) return null;
  const { data: tables } = await supabase.from("event_tables").select("table_number, qr_token").eq("event_id", id).order("table_number");
  return {
    event: event as unknown as { id: string; starts_at: string; status: EventStatus; venue: { name: string } | null },
    tables: ((tables as TableRow[] | null) ?? []).filter((t) => isQrToken(t.qr_token)),
  };
}

/**
 * Impression des codes QR des tables (section 11.2-5) : une carte par table, à poser sur
 * la table. Le code mène à la page de vote ; il n'est valable que pendant la soirée.
 */
export default async function EveningTablesPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("events.manage")) notFound();
  const loaded = await loadTables(id);
  if (!loaded) notFound();

  const t = await getTranslations("Admin.evenings.tables");
  const format = await getFormatter();
  const { event, tables } = loaded;
  const printable = canPrintTables(event.status, tables.length > 0);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const date = format.dateTime(new Date(event.starts_at), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="print:hidden">
        <Link href={`/admin/soirees/${event.id}`} className="text-sm text-link underline-offset-4 hover:underline">
          {t("back")}
        </Link>
        <h1 className="mt-6 text-4xl">{t("title")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{printable ? t("intro", { count: tables.length }) : t("notReady")}</p>
        {printable && (
          <div className="mt-8">
            <PrintButton />
          </div>
        )}
      </div>

      {printable && (
        <ul className="mt-12 grid gap-8 sm:grid-cols-2 print:mt-0 print:grid-cols-2 print:gap-0">
          {tables.map((table) => {
            const { size, path } = qrPath(voteUrl(siteUrl, table.qr_token));
            return (
              <li
                key={table.table_number}
                className="flex break-inside-avoid flex-col items-center border border-line bg-bg-elevated px-8 py-10 text-center print:min-h-[50vh] print:border-dashed"
              >
                <Logo />
                <p className="eyebrow mt-6 first-letter:uppercase">
                  {date}
                  {event.venue && ` · ${event.venue.name}`}
                </p>
                <p className="mt-3 text-4xl tabular-nums">{t("table", { number: table.table_number })}</p>
                <svg
                  role="img"
                  aria-label={t("qrLabel", { number: table.table_number })}
                  viewBox={`-2 -2 ${size + 4} ${size + 4}`}
                  shapeRendering="crispEdges"
                  className="mt-6 size-56 bg-white text-ink"
                >
                  <path d={path} fill="currentColor" />
                </svg>
                <p className="mt-6 max-w-xs text-sm text-fg-muted">{t("scan")}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
