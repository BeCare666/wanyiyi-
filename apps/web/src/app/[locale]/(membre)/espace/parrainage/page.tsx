import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { whatsappShare } from "@/lib/cagnotte";
import { availableCredits, type CreditRow, referralLink, type ReferralRow } from "@/lib/referral";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.referral");
  return { title: t("title") };
}

/**
 * Parrainage (phase 4, question 4) : code et lien personnels pour un membre vérifié, filleuls
 * (prénom et état seulement), réductions obtenues. Acquis à la première soirée payée et pointée
 * du filleul ; récompense réglée par l'équipe, dans une limite annuelle.
 */
export default async function ReferralPage() {
  const t = await getTranslations("Member.referral");
  const format = await getFormatter();
  const member = await getSessionMember();
  const supabase = await createSupabaseServer();
  if (!member || !supabase) return null;

  const [codeResult, { data: referrals }, { data: credits }, { data: settings }] = await Promise.all([
    supabase.rpc("my_referral_code"),
    supabase.rpc("my_referrals"),
    supabase.rpc("my_credits"),
    supabase.rpc("referral_settings"),
  ]);
  const code = typeof codeResult.data === "string" ? codeResult.data : null;
  const rules = ((settings ?? []) as { reward_xof: number; max_rewarded_per_year: number }[])[0];
  const amount = (xof: number) => format.number(xof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 });
  const rows = (referrals ?? []) as ReferralRow[];
  const available = availableCredits((credits ?? []) as CreditRow[]);
  const link = code ? referralLink(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000", code) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("eyebrow")}
        </p>
        <h1 className="mt-6 font-serif text-4xl">{t("title")}</h1>
        {rules && (
          <p className="mt-6 max-w-measure text-lg text-fg-muted">{t("intro", { amount: amount(rules.reward_xof), max: rules.max_rewarded_per_year })}</p>
        )}
      </header>

      {codeResult.error ? (
        <p role="status" className="mt-14 border-l border-accent pl-5 text-fg-muted">
          {codeResult.error.message === "not_verified" ? t("notVerified") : t("unavailable")}{" "}
          {codeResult.error.message === "not_verified" && (
            <Link href="/espace/verification" className="text-link underline-offset-4 hover:underline">
              {t("verify")}
            </Link>
          )}
        </p>
      ) : (
        code &&
        link && (
          <section aria-labelledby="mon-lien" className="mt-14 border-t border-line pt-8">
            <h2 id="mon-lien" className="eyebrow">
              {t("myLink")}
            </h2>
            <p className="mt-4 font-serif text-3xl tracking-widest">{code}</p>
            <p className="mt-3 break-all text-sm">
              <a href={link} className="text-link underline-offset-4 hover:underline">
                {link}
              </a>
            </p>
            <p className="mt-4">
              <a href={whatsappShare(t("shareText"), link)} target="_blank" rel="noopener noreferrer" className="text-link underline-offset-4 hover:underline">
                {t("shareWhatsapp")}
              </a>
            </p>
            <p className="mt-4 max-w-measure text-sm text-fg-muted">{t("howItWorks")}</p>
          </section>
        )
      )}

      <section aria-labelledby="mes-reductions" className="mt-14 border-t border-line pt-8">
        <h2 id="mes-reductions" className="eyebrow">
          {t("credits")}
        </h2>
        <p className="mt-4">
          {available.length === 0 ? t("noCredit") : t("creditsAvailable", { count: available.length, amount: amount(available[0]!.amount_xof) })}
        </p>
        <p className="mt-2 max-w-measure text-sm text-fg-muted">{t("creditsHelp")}</p>
      </section>

      <section aria-labelledby="mes-filleuls" className="mt-14 border-t border-line pt-8">
        <h2 id="mes-filleuls" className="eyebrow">
          {t("referrals")}
        </h2>
        {rows.length === 0 ? (
          <p className="mt-4 text-fg-muted">{t("none")}</p>
        ) : (
          <ul className="mt-4 border-t border-line">
            {rows.map((r, i) => (
              <li key={`${r.created_at}-${i}`} className="flex flex-wrap justify-between gap-4 border-b border-line py-4">
                <span>{r.first_name ?? t("gone")}</span>
                <span className="text-sm text-fg-muted">{r.acquired ? (r.rewarded ? t("acquiredRewarded") : t("acquiredLimit")) : t("pending")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
