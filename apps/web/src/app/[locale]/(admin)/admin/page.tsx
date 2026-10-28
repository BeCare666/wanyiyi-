import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { visibleAdminNav } from "@/components/admin/adminNav";
import { Link } from "@/i18n/navigation";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";

type Indicators = {
  open_cagnottes: number | null;
  collected_xof: number | string | null;
  pending_payouts: number | null;
  referrals_this_month: number | null;
  active_providers: number | null;
  provider_contacts_this_month: number | null;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin");
  return { title: t("home") };
}

/**
 * Accueil de l'administration : indicateurs de la phase 4 (question 6), chacun réservé à la
 * permission de son module, puis les modules ouverts au rôle de la personne.
 */
export default async function AdminHomePage() {
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const staff = await getStaffMember();
  if (!staff) return null;
  const groups = visibleAdminNav(staff.permissions);
  const canSee = ["cagnottes.manage", "members.manage", "providers.manage"].some((p) => staff.permissions.includes(p as never));
  const supabase = canSee ? await createSupabaseServer() : null;
  const { data } = supabase ? await supabase.rpc("admin_phase4_indicators") : { data: null };
  const row = ((data ?? []) as Indicators[])[0];
  const count = (n: number) => format.number(n);
  const indicators = row
    ? [
        row.open_cagnottes !== null && { key: "openCagnottes", value: count(row.open_cagnottes) },
        row.collected_xof !== null && {
          key: "collected",
          value: format.number(Number(row.collected_xof), { style: "currency", currency: "XOF", maximumFractionDigits: 0 }),
        },
        row.pending_payouts !== null && { key: "pendingPayouts", value: count(row.pending_payouts) },
        row.referrals_this_month !== null && { key: "referrals", value: count(row.referrals_this_month) },
        row.active_providers !== null && { key: "activeProviders", value: count(row.active_providers) },
        row.provider_contacts_this_month !== null && { key: "providerContacts", value: count(row.provider_contacts_this_month) },
      ].filter((i): i is { key: string; value: string } => Boolean(i))
    : [];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-4xl">{t("home")}</h1>
      {indicators.length > 0 && (
        <section aria-labelledby="indicateurs" className="mt-10">
          <h2 id="indicateurs" className="eyebrow">
            {t("indicators.title")}
          </h2>
          <dl className="mt-4 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {indicators.map((i) => (
              <div key={i.key} className="bg-bg px-6 py-5">
                <dt className="text-sm text-fg-muted">{t(`indicators.${i.key}`)}</dt>
                <dd className="mt-1 font-serif text-3xl tabular-nums">{i.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {groups.length === 0 ? (
        <p className="mt-10 max-w-measure text-fg-muted">{t("noModule")}</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="mt-10">
            <h2 className="eyebrow">{t(`groups.${group.key}`)}</h2>
            <ul className="mt-4 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => (
                <li key={item.key} className="bg-bg">
                  <Link href={item.href} className="flex min-h-24 items-center gap-4 px-6 py-5 transition-opacity duration-300 hover:opacity-80">
                    <item.Icon size={24} weight="light" aria-hidden="true" />
                    <span>
                      <span className="block font-serif text-xl">{t(`nav.${item.key}`)}</span>
                      <span className="mt-1 block text-sm text-fg-muted">{t(`navHelp.${item.key}`)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
