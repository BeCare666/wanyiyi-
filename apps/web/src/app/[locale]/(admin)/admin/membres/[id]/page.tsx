import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { ageOn, memberName } from "../../verifications/queue";
import { availableActions, type HistoryRow, historyKey, type MemberCard } from "../members";
import { MemberDetails } from "@/components/admin/MemberDetails";
import { BlockEveningsForm, DeleteAccountForm, ReactivateButton, RoleForm, SanctionForm } from "./MemberActions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("members") };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);

/**
 * Fiche d'un membre (section 11.2-2) : identité, état, historique (soirées, vérification,
 * sanctions, paiements, rôle ; jamais les votes) et actions décidées le 19 octobre 2026.
 */
export default async function AdminMemberPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("members.manage")) notFound();
  const supabase = await createSupabaseServer();
  if (!supabase) notFound();
  const [cardResult, historyResult, referralsResult] = await Promise.all([
    supabase.rpc("admin_member", { p_user: id }),
    supabase.rpc("member_history", { p_user: id }),
    // Parrain et filleuls (phase 4, question 4 e)
    supabase.rpc("admin_member_referrals", { p_user: id }),
  ]);
  const card = ((cardResult.data as MemberCard[] | null) ?? [])[0];
  if (!card) notFound();
  const history = (historyResult.data as HistoryRow[] | null) ?? [];
  const referrals = (referralsResult.data ?? []) as Array<{
    role: "referrer" | "referred";
    user_id: string;
    first_name: string | null;
    member_number: string | null;
    acquired: boolean;
    rewarded: boolean;
  }>;

  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const now = new Date();
  const dateTime = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const date = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "long", year: "numeric" });
  const blockedUntil = card.evenings_blocked_until && new Date(card.evenings_blocked_until) > now ? card.evenings_blocked_until : null;
  const actions = availableActions(card, staff.id, staff.permissions.includes("roles.manage"));
  // Suppression immédiate (décision du 29 octobre 2026) : super administration, compte d'un membre
  const canDelete = staff.permissions.includes("accounts.delete") && card.user_id !== staff.id && card.role === "member";

  /** Précision d'une ligne d'historique, selon son type. */
  const detailOf = (row: HistoryRow) => {
    const d = row.detail ?? {};
    const startsAt = text(d.starts_at);
    if (startsAt && text(d.event_id)) {
      return (
        <Link href={`/admin/soirees/${String(d.event_id)}`} className="text-link underline-offset-4 hover:underline">
          {t("members.history.evening", { date: dateTime(startsAt) })}
        </Link>
      );
    }
    if (text(d.reason)) return t("members.history.reason", { reason: String(d.reason) });
    if (text(d.note)) return t("members.history.note", { note: String(d.note) });
    if (typeof d.amount_xof === "number") return format.number(d.amount_xof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 });
    if (text(d.from) && text(d.to)) return t("members.history.role", { from: t(`members.roles.${String(d.from)}`), to: t(`members.roles.${String(d.to)}`) });
    if (row.kind === "member.evenings_blocked") return text(d.until) ? t("members.history.blockedUntil", { date: dateTime(String(d.until)) }) : t("members.history.unblocked");
    return null;
  };

  const facts: Array<[string, string]> = [
    [t("members.card.number"), card.member_number ?? "·"],
    [t("members.card.phone"), card.phone ?? "·"],
    [t("members.columns.role"), t(`members.roles.${card.role}`)],
    [t("members.columns.status"), card.status ? t(`members.status.${card.status}`) : t("verifications.noProfile")],
    [t("members.sex"), card.sex ? t(`verifications.identity.sexes.${card.sex}`) : "·"],
    [t("verifications.identity.birthDate"), card.birth_date ? `${date(card.birth_date)} · ${t("verifications.identity.age", { age: ageOn(card.birth_date, now) })}` : "·"],
    [t("verifications.identity.city"), card.city ?? "·"],
    [t("members.card.joined"), date(card.created_at)],
    [t("members.card.consent"), card.consent_at ? dateTime(card.consent_at) : t("members.card.noConsent")],
    [t("members.card.blocked"), blockedUntil ? dateTime(blockedUntil) : t("members.card.notBlocked")],
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/admin/membres" className="text-sm text-link underline-offset-4 hover:underline">
        {t("members.back")}
      </Link>

      <header className="mt-6">
        <p className="eyebrow">{t("groups.members")}</p>
        <h1 className="mt-4 text-4xl">{memberName(card) ?? t("verifications.noProfile")}</h1>
      </header>

      <dl className="mt-10 grid gap-6 border-t border-line pt-8 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-fg-muted">{label}</dt>
            <dd className="mt-1">{value}</dd>
          </div>
        ))}
      </dl>
      {card.verification_id && card.verification_status && (
        <p className="mt-6 text-sm">
          {t("members.card.verification", { status: t(`verifications.status.${card.verification_status}`) })}{" "}
          {(card.verification_status === "pending" || card.verification_status === "to_correct") && staff.permissions.includes("verifications.review") && (
            <Link href={`/admin/verifications/${card.verification_id}`} className="text-link underline-offset-4 hover:underline">
              {t("members.card.openVerification")}
            </Link>
          )}
        </p>
      )}

      <MemberDetails userId={card.user_id} name={memberName(card) ?? card.member_number ?? ""} />

      <section aria-labelledby="actions" className="mt-12 border-t border-line pt-8">
        <h2 id="actions" className="text-2xl">{t("members.actions.title")}</h2>
        <div className="mt-6 grid gap-12 lg:grid-cols-2">
          {actions.reactivate && (
            <div>
              <h3 className="eyebrow">{t("members.actions.reactivate.title")}</h3>
              <div className="mt-4">
                <ReactivateButton userId={card.user_id} />
              </div>
            </div>
          )}
          {actions.suspend && (
            <div>
              <h3 className="eyebrow">{t("members.actions.suspend.title")}</h3>
              <div className="mt-4">
                <SanctionForm userId={card.user_id} kind="suspend" />
              </div>
            </div>
          )}
          {actions.blockEvenings && (
            <div>
              <h3 className="eyebrow">{t("members.actions.block.title")}</h3>
              <div className="mt-4">
                <BlockEveningsForm userId={card.user_id} blockedUntil={blockedUntil} />
              </div>
            </div>
          )}
          {actions.role && (
            <div>
              <h3 className="eyebrow">{t("members.actions.role.title")}</h3>
              <div className="mt-4">
                <RoleForm userId={card.user_id} current={card.role} />
              </div>
            </div>
          )}
          {actions.exclude && (
            <div>
              <h3 className="eyebrow">{t("members.actions.exclude.title")}</h3>
              <div className="mt-4">
                <SanctionForm userId={card.user_id} kind="exclude" />
              </div>
            </div>
          )}
          {canDelete && (
            <div>
              <h3 className="eyebrow">{t("members.actions.delete.title")}</h3>
              <div className="mt-4">
                <DeleteAccountForm userId={card.user_id} />
              </div>
            </div>
          )}
        </div>
        {!Object.values(actions).some(Boolean) && !canDelete && <p className="mt-4 text-fg-muted">{t("members.actions.none")}</p>}
      </section>

      <section aria-labelledby="parrainage" className="mt-12 border-t border-line pt-8">
        <h2 id="parrainage" className="text-2xl">{t("members.referral.title")}</h2>
        {referrals.length === 0 ? (
          <p className="mt-4 text-fg-muted">{t("members.referral.none")}</p>
        ) : (
          <ul className="mt-4 border-t border-line text-sm">
            {referrals.map((r) => (
              <li key={`${r.role}-${r.user_id}`} className="flex flex-wrap justify-between gap-4 border-b border-line py-3">
                <span>
                  {t(`members.referral.${r.role}`)} :{" "}
                  <Link href={`/admin/membres/${r.user_id}`} className="text-link underline-offset-4 hover:underline">
                    {[r.first_name, r.member_number].filter(Boolean).join(" · ") || t("verifications.noProfile")}
                  </Link>
                </span>
                <span className="text-fg-muted">
                  {r.acquired ? (r.rewarded ? t("members.referral.acquiredRewarded") : t("members.referral.acquired")) : t("members.referral.pending")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history" className="mt-12 border-t border-line pt-8">
        <h2 id="history" className="text-2xl">{t("members.history.title")}</h2>
        <p className="mt-2 text-sm text-fg-muted">{t("members.history.noVotes")}</p>
        {history.length === 0 ? (
          <p className="mt-6 text-fg-muted">{t("members.history.empty")}</p>
        ) : (
          <ol className="mt-6 border-t border-line text-sm">
            {history.map((row, i) => {
              const detail = detailOf(row);
              return (
                <li key={`${row.kind}-${row.at}-${i}`} className="grid gap-1 border-b border-line py-4 md:grid-cols-12 md:gap-6">
                  <span className="text-fg-muted md:col-span-3">{row.at ? dateTime(row.at) : "·"}</span>
                  <span className="md:col-span-9">
                    {t(`members.history.kinds.${historyKey(row.kind)}`)}
                    {detail && <span className="block text-fg-muted">{detail}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
