import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { filterQueue, memberName, parseQueueFilter, type QueueRow, queueFilters } from "./queue";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("verifications") };
}

type Props = { searchParams: Promise<{ etat?: string | string[] }> };

/**
 * File des vérifications (section 11.2-3) : dossiers en attente ou à corriger,
 * les plus anciens d'abord. Réservée à la permission verifications.review.
 */
export default async function VerificationQueuePage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("verifications.review")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const filter = parseQueueFilter((await searchParams).etat);
  const supabase = await createSupabaseServer();
  const result = supabase ? await supabase.rpc("verification_queue") : null;
  const rows = filterQueue(((result?.data ?? []) as QueueRow[]) ?? [], filter);

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.members")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.verifications")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("verifications.intro")}</p>
      </header>

      <nav aria-label={t("verifications.filters.label")} className="mt-10 flex flex-wrap gap-2">
        {queueFilters.map(({ key, query }) => (
          <Link
            key={key}
            href={query ? { pathname: "/admin/verifications", query: { etat: query } } : "/admin/verifications"}
            aria-current={filter === key ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center rounded-sm border px-4 text-sm",
              filter === key ? "border-fg bg-fg text-bg" : "border-line text-fg hover:border-fg",
            )}
          >
            {t(`verifications.filters.${key}`)}
          </Link>
        ))}
      </nav>

      {!result || result.error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("verifications.empty")}</p>
      ) : (
        <table className="mt-10 w-full border-collapse text-left text-sm">
          <caption className="sr-only">{t("nav.verifications")}</caption>
          <thead className="hidden border-b border-line-strong md:table-header-group">
            <tr>
              <th scope="col" className="py-3 pr-4 font-medium">{t("verifications.columns.member")}</th>
              <th scope="col" className="py-3 pr-4 font-medium">{t("verifications.columns.status")}</th>
              <th scope="col" className="py-3 pr-4 font-medium">{t("verifications.columns.dossier")}</th>
              <th scope="col" className="py-3 font-medium md:text-right">{t("verifications.columns.submitted")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.verification_id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                <th scope="row" className="font-normal md:py-4 md:pr-4">
                  <Link href={`/admin/verifications/${row.verification_id}`} className="font-medium underline-offset-4 hover:underline">
                    {memberName(row) ?? t("verifications.noProfile")}
                  </Link>
                  {row.member_number && <span className="ml-2 text-fg-muted">{row.member_number}</span>}
                </th>
                <td className="md:py-4 md:pr-4">{t(`verifications.status.${row.status}`)}</td>
                <td className="md:py-4 md:pr-4">
                  <span className={row.ready ? "text-fg" : "text-fg-muted"}>
                    {t(row.ready ? "verifications.ready" : "verifications.incomplete")}
                  </span>
                  {row.document_kind && <span className="text-fg-muted"> · {t(`verifications.kinds.${row.document_kind}`)}</span>}
                </td>
                <td className="text-fg-muted md:py-4 md:text-right">
                  {row.submitted_at ? format.dateTime(new Date(row.submitted_at), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "·"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
