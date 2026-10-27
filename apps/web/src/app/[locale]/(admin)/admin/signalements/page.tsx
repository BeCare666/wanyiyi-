import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { ReportDecision, ReportedMessages } from "./ReportActions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("reports") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

type ReportRow = {
  id: string;
  reason: string;
  details: string | null;
  status: "open" | "in_review" | "resolved" | "dismissed";
  due_at: string;
  created_at: string;
  conversation_kind: "discovery" | "couple" | null;
  reporter_first_name: string | null;
  reporter_number: string | null;
  reported_first_name: string | null;
  reported_number: string | null;
  messages: number;
  decision: string | null;
  decision_reason: string | null;
  resolved_at: string | null;
};

/**
 * Signalements (section 11.2-4, question 11) : file à traiter sous 24 heures, les plus urgents
 * d'abord. La modération lit (reports.read) ; l'administration décide (reports.manage). Seuls les
 * messages signalés sont lisibles, chaque consultation est journalisée.
 */
export default async function ReportsPage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("reports.read")) notFound();
  const canDecide = staff.permissions.includes("reports.manage");
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const all = (await searchParams).tous === "1";
  const supabase = await createSupabaseServer();
  const result = supabase ? await supabase.rpc("admin_reports", { p_open_only: !all }) : null;
  const reports = (result?.data ?? []) as ReportRow[];
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Porto-Novo" });
  const now = Date.now();

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.members")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.reports")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("reports.intro")}</p>
        <p className="mt-4 text-sm">
          <Link href={all ? "/admin/signalements" : "/admin/signalements?tous=1"} className="text-link underline-offset-4 hover:underline">
            {all ? t("reports.showOpen") : t("reports.showAll")}
          </Link>
        </p>
      </header>

      {!result || result.error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : reports.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("reports.empty")}</p>
      ) : (
        <ol className="mt-10 border-t border-line">
          {reports.map((r) => {
            const open = r.status === "open" || r.status === "in_review";
            const late = open && new Date(r.due_at).getTime() < now;
            return (
              <li key={r.id} className={cn("grid gap-4 border-b border-line py-7 md:grid-cols-12 md:gap-8", !open && "text-fg-muted")}>
                <div className="md:col-span-5">
                  <p className={cn("font-medium", r.reason === "threat" && open && "text-accent")}>{t(`reports.reasons.${r.reason}`)}</p>
                  {r.details && <p className="mt-2 whitespace-pre-line text-sm">{r.details}</p>}
                  <p className="mt-2 text-sm text-fg-muted">
                    {t("reports.reported", { name: r.reported_first_name ?? "", number: r.reported_number ?? "" })}
                    <span className="block">{t("reports.reporter", { name: r.reporter_first_name ?? "", number: r.reporter_number ?? "" })}</span>
                    {r.conversation_kind && <span className="block">{t(`reports.kinds.${r.conversation_kind}`)}</span>}
                  </p>
                </div>
                <div className="text-sm md:col-span-3">
                  <p>{t(`reports.status.${r.status}`)}</p>
                  <p className="text-fg-muted">{t("reports.createdAt", { date: when(r.created_at) })}</p>
                  {open && <p className={cn(late ? "font-medium text-accent" : "text-fg-muted")}>{t(late ? "reports.late" : "reports.dueAt", { date: when(r.due_at) })}</p>}
                  {r.decision && (
                    <p className="mt-2">
                      {t(`reports.decisions.${r.decision}`)}
                      {r.decision_reason && <span className="block text-fg-muted">{r.decision_reason}</span>}
                    </p>
                  )}
                </div>
                <div className="md:col-span-4">
                  <p className="text-sm">{t("reports.messages", { count: r.messages })}</p>
                  {r.messages > 0 && <ReportedMessages reportId={r.id} />}
                  {open && canDecide && <ReportDecision reportId={r.id} />}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
