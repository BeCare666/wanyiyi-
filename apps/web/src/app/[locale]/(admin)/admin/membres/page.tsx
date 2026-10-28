import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { fieldClass } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { ageOn, memberName } from "../verifications/queue";
import { AdvancedFilters, type SavedFilterLink } from "./AdvancedFilters";
import { BulkActions, type InvitableEvening, SelectAll } from "./BulkActions";
import { BULK_FIELD, BULK_FORM, everyone } from "./bulk";
import { ReferralSettings } from "./ReferralSettings";
import { exportFormats } from "./exporting";
import {
  combineFilters,
  decodeFilter,
  encodeFilter,
  type FilterGroup,
  formatSort,
  isBuilderFilter,
  listQuery,
  type MemberColumn,
  parseColumns,
  parseSort,
  type SortKey,
} from "./filters";
import { type MemberRow, memberQueryParams, memberStatuses, PAGE_SIZE, pageCount, parseMemberQuery, roles, sexes } from "./members";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("members") };
}

type Params = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<Params> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type SavedRow = { id: string; owner_id: string; name: string; shared: boolean; definition: unknown; sort: SortKey[] | null; columns: string[] | null };

/**
 * Liste des membres (sections 11.2-2 et 11.3) : recherche et filtres rapides, filtres avancés
 * ET / OU, tri multi-colonnes, colonnes choisies, filtres enregistrés ; tout est dans l'adresse.
 * Pagination côté serveur. Réservée à la permission members.manage.
 */
export default async function AdminMembersPage({ searchParams }: Props) {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("members.manage")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const params = await searchParams;
  const query = parseMemberQuery(params);
  const advanced = decodeFilter(first(params.f));
  const sort = parseSort(first(params.tri));
  const columns = parseColumns(first(params.colonnes));
  // Paramètres des filtres avancés, gardés par le formulaire rapide et la pagination
  const advancedParams = listQuery({}, advanced, sort, columns);
  const quickParams = memberQueryParams(query, 1);

  const supabase = await createSupabaseServer();
  const listFilter = combineFilters(query, advanced);
  const [result, savedResult, eveningsResult, referralResult] = supabase
    ? await Promise.all([
        supabase.rpc("admin_members_filtered", {
          p_filter: listFilter,
          p_sort: sort.length > 0 ? sort : null,
          p_limit: PAGE_SIZE,
          p_offset: (query.page - 1) * PAGE_SIZE,
        }),
        supabase.from("saved_filters").select("id, owner_id, name, shared, definition, sort, columns").eq("resource", "members").order("name"),
        supabase.rpc("invitable_events"),
        supabase.rpc("referral_settings"),
      ])
    : [null, null, null, null];
  const referralRules = ((referralResult?.data ?? []) as { reward_xof: number; max_rewarded_per_year: number }[])[0];
  // Soirées vers lesquelles inviter (action groupée)
  const evenings: InvitableEvening[] = ((eveningsResult?.data ?? []) as Array<{ event_id: string; starts_at: string; venue_name: string | null; status: string }>).map(
    (e) => ({ id: e.event_id, startsAt: e.starts_at, venue: e.venue_name, full: e.status === "full" }),
  );
  const rows = (result?.data ?? []) as MemberRow[];
  const total = rows[0]?.total ?? 0;
  const pages = pageCount(total);
  const selectClass = cn(fieldClass, "mt-1 text-base");
  const saved: SavedFilterLink[] = ((savedResult?.data ?? []) as SavedRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    shared: s.shared,
    mine: s.owner_id === staff.id,
    query: listQuery(
      {},
      isBuilderFilter(s.definition) && (s.definition as FilterGroup).items.length > 0 ? (s.definition as FilterGroup) : null,
      parseSort(formatSort(s.sort ?? [])),
      parseColumns((s.columns ?? []).join(",")),
    ),
  }));
  const pageHref = (page: number) => ({ pathname: "/admin/membres", query: { ...memberQueryParams(query, page), ...advancedParams } });
  const show = (c: MemberColumn) => columns.includes(c);

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.members")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.members")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("members.intro")}</p>
      </header>

      {/* Formulaire GET : les filtres restent dans l'adresse, partageables entre administrateurs */}
      <form method="get" role="search" className="mt-10 grid gap-6 border-t border-line pt-8 md:grid-cols-12 md:items-end">
        {Object.entries(advancedParams).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
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

      {/* La clé remet le constructeur à l'état de l'adresse après chaque navigation */}
      <AdvancedFilters
        key={advanced ? encodeFilter(advanced) + formatSort(sort) + columns.join(",") : formatSort(sort) + columns.join(",")}
        quick={quickParams}
        filter={advanced}
        sort={sort}
        columns={columns}
        saved={saved}
      />

      {!result || result.error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("members.empty")}</p>
      ) : (
        <>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 text-sm">
            <p className="text-fg-muted" role="status">
              {t("members.count", { count: total })}
            </p>
            {/* Export du résultat filtré, journalisé par la base (5 000 lignes au plus) */}
            <p className="flex flex-wrap items-center gap-4">
              <span className="text-fg-muted">{t("members.export.label")}</span>
              {exportFormats.map((format) => (
                <Link
                  key={format}
                  href={{ pathname: "/admin/membres/export", query: { ...quickParams, ...advancedParams, format } }}
                  prefetch={false}
                  className="text-link underline-offset-4 hover:underline"
                >
                  {t(`members.export.formats.${format}`)}
                </Link>
              ))}
            </p>
          </div>
          {total > 5000 && <p className="mt-2 text-xs text-fg-muted">{t("members.export.limit", { max: 5000 })}</p>}
          <BulkActions filter={listFilter ?? everyone} total={total} evenings={evenings} />
          <table className="mt-4 w-full border-collapse text-left text-sm">
            <caption className="sr-only">{t("nav.members")}</caption>
            <thead className="hidden border-b border-line-strong md:table-header-group">
              <tr>
                <th scope="col" className="w-8 py-3 pr-3">
                  <SelectAll label={t("members.bulk.selectAll")} />
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">{t("members.columns.member")}</th>
                {columns.map((c) => (
                  <th key={c} scope="col" className={cn("py-3 pr-4 font-medium", c === "joined" && "md:pr-0 md:text-right")}>
                    {t(`members.advanced.columnNames.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user_id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                  <td className="md:py-4 md:pr-3">
                    {/* Rattachée au formulaire des actions groupées */}
                    <input
                      type="checkbox"
                      form={BULK_FORM}
                      name={BULK_FIELD}
                      value={row.user_id}
                      aria-label={t("members.bulk.selectOne", { name: memberName(row) ?? row.member_number ?? "" })}
                    />
                  </td>
                  <th scope="row" className="font-normal md:py-4 md:pr-4">
                    <Link href={`/admin/membres/${row.user_id}`} className="font-medium underline-offset-4 hover:underline">
                      {memberName(row) ?? t("verifications.noProfile")}
                    </Link>
                    {row.member_number && <span className="block text-fg-muted">{row.member_number}</span>}
                  </th>
                  {show("status") && <td className="md:py-4 md:pr-4">{row.status ? t(`members.status.${row.status}`) : t("verifications.noProfile")}</td>}
                  {show("role") && <td className="md:py-4 md:pr-4">{t(`members.roles.${row.role}`)}</td>}
                  {show("sex") && <td className="md:py-4 md:pr-4">{row.sex ? t(`verifications.identity.sexes.${row.sex}`) : ""}</td>}
                  {show("age") && (
                    <td className="tabular-nums md:py-4 md:pr-4">{row.birth_date ? t("verifications.identity.age", { age: ageOn(row.birth_date, new Date()) }) : ""}</td>
                  )}
                  {show("city") && <td className="md:py-4 md:pr-4">{row.city}</td>}
                  {show("phone") && <td className="tabular-nums md:py-4 md:pr-4">{row.phone}</td>}
                  {show("activity") && (
                    <td className="tabular-nums text-fg-muted md:py-4 md:pr-4">{t("members.activity", { evenings: row.evenings_attended, matches: row.matches })}</td>
                  )}
                  {show("joined") && (
                    <td className="text-fg-muted md:py-4 md:text-right">{format.dateTime(new Date(row.created_at), { day: "numeric", month: "short", year: "numeric" })}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <nav aria-label={t("members.pagination")} className="mt-8 flex items-center justify-between gap-4 text-sm">
              {query.page > 1 ? (
                <Link href={pageHref(query.page - 1)} className="text-link underline-offset-4 hover:underline">
                  {t("members.previous")}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-fg-muted">{t("members.page", { page: query.page, pages })}</span>
              {query.page < pages ? (
                <Link href={pageHref(query.page + 1)} className="text-link underline-offset-4 hover:underline">
                  {t("members.next")}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}

      {/* Parrainage (phase 4, question 4 d) : montants réglables */}
      {referralRules && (
        <section aria-labelledby="parrainage" className="mt-12 border-t border-line pt-8">
          <h2 id="parrainage" className="text-2xl">
            {t("members.referral.settings.title")}
          </h2>
          <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("members.referral.settings.intro")}</p>
          <ReferralSettings reward={referralRules.reward_xof} max={referralRules.max_rewarded_per_year} />
        </section>
      )}
    </div>
  );
}
