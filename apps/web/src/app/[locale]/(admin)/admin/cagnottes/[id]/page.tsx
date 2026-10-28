import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { PayoutForm } from "../CagnotteForms";
import type { AdminContribution, AdminPayout } from "../cagnottes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("cagnottes") };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AdminCagnotte = {
  id: string;
  couple_id: string;
  status: string;
  title: string;
  goal_xof: number | null;
  closes_at: string;
  opened_at: string | null;
  closed_reason: string | null;
  payout_phone: string;
  commission_percent: number | string;
  collected_xof: number;
  a_first_name: string | null;
  a_number: string | null;
  b_first_name: string | null;
  b_number: string | null;
  contributions: AdminContribution[];
  payouts: AdminPayout[];
};

/**
 * Fiche d'une cagnotte (phase 4, question 3) : couple, contributions avec les noms, reversements
 * demandés par le couple et faits à la main par l'équipe ; après une séparation, contributions à
 * rembourser depuis Paiements.
 */
export default async function AdminCagnottePage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("cagnottes.manage")) notFound();
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const supabase = await createSupabaseServer();
  if (!supabase) notFound();
  const { data } = await supabase.rpc("admin_cagnotte", { p_id: id });
  const g = ((data ?? []) as AdminCagnotte[])[0];
  if (!g) notFound();
  const amount = (xof: number) => format.number(xof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 });
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Porto-Novo" });
  const member = (name: string | null, number: string | null) => [name, number].filter(Boolean).join(" · ") || t("verifications.noProfile");

  return (
    <div className="mx-auto max-w-4xl">
      <p>
        <Link href="/admin/cagnottes" className="text-sm text-link underline-offset-4 hover:underline">
          {t("cagnottes.back")}
        </Link>
      </p>
      <header className="mt-6">
        <p className="eyebrow">{t("nav.cagnottes")}</p>
        <h1 className="mt-4 text-4xl">{g.title}</h1>
        <p className="mt-4 text-fg-muted">
          {member(g.a_first_name, g.a_number)} · {member(g.b_first_name, g.b_number)} ·{" "}
          <Link href="/admin/couples" className="text-link underline-offset-4 hover:underline">
            {t("nav.couples")}
          </Link>
        </p>
      </header>

      <dl className="mt-10 grid gap-3 border-t border-line pt-8 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-fg-muted">{t("lists.cagnottes.columns.status")}</dt>
          <dd>
            {t(`cagnottes.status.${g.status}`)}
            {g.closed_reason && ` · ${t(`cagnottes.reasons.${g.closed_reason}`)}`}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">{t("lists.cagnottes.columns.collected")}</dt>
          <dd className="tabular-nums">
            {amount(g.collected_xof)}
            {g.goal_xof ? ` / ${amount(g.goal_xof)}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">{t("lists.cagnottes.columns.closes")}</dt>
          <dd>{when(g.closes_at)}</dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">{t("cagnottes.phone")}</dt>
          <dd>{g.payout_phone}</dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">{t("cagnottes.commission")}</dt>
          <dd>{Number(g.commission_percent)} %</dd>
        </div>
      </dl>

      {g.closed_reason === "separation" && (
        <p role="status" className="mt-8 border-l border-accent pl-5">
          {t("cagnottes.separationHelp")}{" "}
          <Link href="/admin/paiements" className="text-link underline-offset-4 hover:underline">
            {t("nav.payments")}
          </Link>
        </p>
      )}

      <section aria-labelledby="reversements" className="mt-12 border-t border-line pt-8">
        <h2 id="reversements" className="text-2xl">
          {t("cagnottes.payouts")}
        </h2>
        {g.payouts.length === 0 ? (
          <p className="mt-4 text-fg-muted">{t("cagnottes.noPayout")}</p>
        ) : (
          <ul className="mt-4 border-t border-line">
            {g.payouts.map((o) => (
              <li key={o.id} className="border-b border-line py-5">
                <p className="flex flex-wrap justify-between gap-4">
                  <span>
                    {t(`cagnottes.payoutStatus.${o.status}`)} · {when(o.requested_at)}
                  </span>
                  <span className="tabular-nums">{amount(o.gross_xof)}</span>
                </p>
                <p className="mt-1 text-sm text-fg-muted">
                  {t("cagnottes.payoutDetail", { commission: amount(o.commission_xof), max: amount(o.gross_xof - o.commission_xof), phone: o.payout_phone })}
                </p>
                {o.status === "paid" && o.sent_xof !== null && (
                  <p className="mt-1 text-sm">
                    {t("cagnottes.paidDetail", { sent: amount(o.sent_xof), reference: o.reference ?? "", date: o.paid_at ? when(o.paid_at) : "" })}
                  </p>
                )}
                {o.status === "requested" && <PayoutForm payoutId={o.id} maxXof={o.gross_xof - o.commission_xof} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="contributions" className="mt-12 border-t border-line pt-8">
        <h2 id="contributions" className="text-2xl">
          {t("cagnottes.contributions")}
        </h2>
        {g.contributions.length === 0 ? (
          <p className="mt-4 text-fg-muted">{t("cagnottes.noContribution")}</p>
        ) : (
          <ul className="mt-4 border-t border-line">
            {g.contributions.map((c) => (
              <li key={c.payment_id} className="flex flex-wrap justify-between gap-4 border-b border-line py-4 text-sm">
                <span>
                  <span className="font-medium">{c.name ?? t("cagnottes.anonymous")}</span>
                  {c.anonymous && c.name && ` (${t("cagnottes.anonymous")})`} · {when(c.created_at)}
                </span>
                <span className="tabular-nums">
                  {amount(c.amount_xof)} ·{" "}
                  {c.status === "refunded"
                    ? t("cagnottes.contribution.refunded")
                    : c.refund_requested
                      ? t("cagnottes.contribution.toRefund")
                      : c.paid_out
                        ? t("cagnottes.contribution.paidOut")
                        : t("cagnottes.contribution.received")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
