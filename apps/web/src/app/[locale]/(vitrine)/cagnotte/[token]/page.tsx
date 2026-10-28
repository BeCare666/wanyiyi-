import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { createSupabaseServer } from "@/lib/supabase/server";
import { ContributionForm } from "./ContributionForm";

type Props = { params: Promise<{ locale: string; token: string }> };

const TOKEN = /^[0-9a-f]{64}$/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Cagnotte" });
  // Page privée par son lien : jamais indexée
  return { title: t("eyebrow"), robots: { index: false, follow: false } };
}

type PublicCagnotte = {
  title: string;
  goal_xof: number | null;
  progress_percent: number | null;
  closes_at: string;
  accepting: boolean;
  min_contribution_xof: number;
};

/**
 * Page publique d'une cagnotte (phase 4, question 3 b) : seulement le titre choisi par le couple,
 * l'objectif et la progression ; ni noms ni photos. Contribution sans compte.
 */
export default async function CagnottePage({ params }: Props) {
  const { token } = await params;
  if (!TOKEN.test(token)) notFound();
  const t = await getTranslations("Cagnotte");
  const format = await getFormatter();
  const supabase = await createSupabaseServer();
  const { data, error } = supabase ? await supabase.rpc("public_cagnotte", { p_token: token }) : { data: null, error: true };
  const cagnotte = ((data ?? []) as PublicCagnotte[])[0];
  if (!error && !cagnotte) notFound();

  return (
    <article className="pb-section pt-36 lg:pt-44">
      <Container>
        <div className="mx-auto max-w-2xl">
          <p className="eyebrow flex items-center gap-4">
            <span aria-hidden="true" className="block h-px w-10 bg-accent" />
            {t("eyebrow")}
          </p>
          {!cagnotte ? (
            <p role="status" className="mt-10 text-fg-muted">
              {t("unavailable")}
            </p>
          ) : (
            <>
              <h1 className="mt-8 text-4xl">{cagnotte.title}</h1>
              <p className="mt-6 text-fg-muted">{t("intro")}</p>
              {cagnotte.goal_xof && (
                <div className="mt-8">
                  <p className="text-sm text-fg-muted">
                    {t("goal", { amount: format.number(cagnotte.goal_xof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 }) })}
                  </p>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={cagnotte.progress_percent ?? 0}
                    aria-label={t("progress", { percent: cagnotte.progress_percent ?? 0 })}
                    className="mt-3 h-1.5 w-full bg-line"
                  >
                    <div className="h-full bg-fg" style={{ width: `${cagnotte.progress_percent ?? 0}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-fg-muted">{t("progress", { percent: cagnotte.progress_percent ?? 0 })}</p>
                </div>
              )}
              {cagnotte.accepting ? (
                <>
                  <p className="mt-6 text-sm text-fg-muted">
                    {t("closes", { date: format.dateTime(new Date(cagnotte.closes_at), { dateStyle: "long", timeZone: "Africa/Porto-Novo" }) })}
                  </p>
                  <ContributionForm token={token} minXof={cagnotte.min_contribution_xof} />
                  <p className="mt-10 max-w-measure text-xs text-fg-muted">{t("privacy")}</p>
                </>
              ) : (
                <p role="status" className="mt-10 border-l border-accent pl-5">
                  {t("closed")}
                </p>
              )}
            </>
          )}
        </div>
      </Container>
    </article>
  );
}
