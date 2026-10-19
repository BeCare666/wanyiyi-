import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { fieldClass } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { ageOn, memberName } from "../verifications/queue";
import { type MemberRow, memberQueryParams, memberRpcArgs, memberStatuses, pageCount, parseMemberQuery, roles, sexes } from "./members";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("members") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Liste des membres (section 11.2-2) : recherche, filtres d'état, de rôle et de sexe reflétés
 * dans l'adresse, pagination côté serveur. Réservée à la permission members.manage.
 */
export default async function AdminMembersPage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("members.manage")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const query = parseMemberQuery(await searchParams);
  const supabase = await createSupabaseServer();
  const result = supabase ? await supabase.rpc("admin_members", memberRpcArgs(query)) : null;
  const rows = (result?.data ?? []) as MemberRow[];
  const total = rows[0]?.total ?? 0;
  const pages = pageCount(total);
  const selectClass = cn(fieldClass, "mt-1 text-base");

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.members")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.members")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("members.intro")}</p>
      </header>

      {/* Formulaire GET : les filtres restent dans l'adresse, partageables entre administrateurs */}
      <form method="get" role="search" className="mt-10 grid gap-6 border-t border-line pt-8 md:grid-cols-12 md:items-end">
        <label className="block md:col-span-4">
          <span className="text-sm font-medium">{t("members.search")}</span>
          <input type="search" name="q" defaultValue={query.search} maxLength={100} className={cn(fieldClass, "mt-1 text-base")} />
        </label>
        <label className="block md:col-span-3">
          <span className="text-sm font-medium">{t("members.columns.status")}</span>
          <select name="etat" defaultValue={query.status ?? ""} className={selectClass}>
            <option value="">{t("members.any")}</option>
            {memberStatuses.map((s) => (
              <option key={s} value={s}>
                {t(`members.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-medium">{t("members.columns.role")}</span>
          <select name="role" defaultValue={query.role ?? ""} className={selectClass}>
            <option value="">{t("members.any")}</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(`members.roles.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-medium">{t("members.sex")}</span>
          <select name="sexe" defaultValue={query.sex ?? ""} className={selectClass}>
            <option value="">{t("members.any")}</option>
            {sexes.map((s) => (
              <option key={s} value={s}>
                {t(`verifications.identity.sexes.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-sm border border-fg px-5 text-sm md:col-span-1">
          {t("members.apply")}
        </button>
      </form>

      {!result || result.error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("members.empty")}</p>
      ) : (
        <>
          <p className="mt-10 text-sm text-fg-muted" role="status">
            {t("members.count", { count: total })}
          </p>
          <table className="mt-4 w-full border-collapse text-left text-sm">
            <caption className="sr-only">{t("nav.members")}</caption>
            <thead className="hidden border-b border-line-strong md:table-header-group">
              <tr>
                <th scope="col" className="py-3 pr-4 font-medium">{t("members.columns.member")}</th>
                <th scope="col" className="py-3 pr-4 font-medium">{t("members.columns.status")}</th>
                <th scope="col" className="py-3 pr-4 font-medium">{t("members.columns.role")}</th>
                <th scope="col" className="py-3 pr-4 font-medium">{t("members.columns.activity")}</th>
                <th scope="col" className="py-3 font-medium md:text-right">{t("members.columns.joined")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user_id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                  <th scope="row" className="font-normal md:py-4 md:pr-4">
                    <Link href={`/admin/membres/${row.user_id}`} className="font-medium underline-offset-4 hover:underline">
                      {memberName(row) ?? t("verifications.noProfile")}
                    </Link>
                    <span className="block text-fg-muted">
                      {[row.member_number, row.birth_date ? t("verifications.identity.age", { age: ageOn(row.birth_date, new Date()) }) : null, row.city]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </th>
                  <td className="md:py-4 md:pr-4">{row.status ? t(`members.status.${row.status}`) : t("verifications.noProfile")}</td>
                  <td className="md:py-4 md:pr-4">{t(`members.roles.${row.role}`)}</td>
                  <td className="tabular-nums text-fg-muted md:py-4 md:pr-4">{t("members.activity", { evenings: row.evenings_attended, matches: row.matches })}</td>
                  <td className="text-fg-muted md:py-4 md:text-right">{format.dateTime(new Date(row.created_at), { day: "numeric", month: "short", year: "numeric" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <nav aria-label={t("members.pagination")} className="mt-8 flex items-center justify-between gap-4 text-sm">
              {query.page > 1 ? (
                <Link href={{ pathname: "/admin/membres", query: memberQueryParams(query, query.page - 1) }} className="text-link underline-offset-4 hover:underline">
                  {t("members.previous")}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-fg-muted">{t("members.page", { page: query.page, pages })}</span>
              {query.page < pages ? (
                <Link href={{ pathname: "/admin/membres", query: memberQueryParams(query, query.page + 1) }} className="text-link underline-offset-4 hover:underline">
                  {t("members.next")}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
