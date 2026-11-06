import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { MinimalHeader } from "@/components/member/MinimalHeader";
import { redirect } from "@/i18n/navigation";
import { memberApi } from "@/lib/api";
import { signInHref } from "@/lib/next-path";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { readTopics } from "@/lib/topics";
import { isQrToken, type Round } from "./vote";
import { VoteBoard } from "./VoteBoard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Vote");
  return { title: t("eyebrow"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ qr: string }> };

const knownErrors = new Set(["outside_evening", "not_in_round", "unavailable"]);

/**
 * Vote de soirée (section 6.2-5) : page mobile ouverte en scannant le code QR de la table.
 * Le code prouve la présence ; la base déduit la personne rencontrée du tour et du votant (9.3).
 */
export default async function VotePage({ params }: Props) {
  const { qr } = await params;
  if (!isQrToken(qr)) notFound();
  const member = await getSessionMember();
  if (!member) return redirect({ href: signInHref(`/vote/${qr}`), locale: await getLocale() });

  const t = await getTranslations("Vote");
  const tTopics = await getTranslations("Topics");
  const supabase = await createSupabaseServer();
  const [result, topicsResult] = await Promise.all([
    memberApi<Round[]>(`/vote/${qr}`),
    // Sujets de débat de la soirée (06/11/2026) ; sans la mise à jour de la base, rien n'est affiché
    supabase ? supabase.rpc("evening_topics_by_qr", { p_qr: qr }) : Promise.resolve({ data: null }),
  ]);
  const topics = readTopics(topicsResult.data);

  return (
    <div data-theme={member.darkMode ? "dark" : undefined} className="min-h-svh bg-bg text-fg">
      <MinimalHeader />
      <main id="contenu" className="mx-auto max-w-xl px-gutter pb-section pt-10">
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("eyebrow")}
        </p>
        <h1 className="mt-6 text-3xl">{t("title")}</h1>
        <p className="mt-5 text-fg-muted">{t("intro")}</p>

        {topics.length > 0 && (
          <section aria-labelledby="sujets" className="mt-8 border-l border-accent pl-5">
            <h2 id="sujets" className="eyebrow">
              {t("topics")}
            </h2>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              {topics.map((key) => (
                <li key={key}>{tTopics(key)}</li>
              ))}
            </ol>
          </section>
        )}

        {result.ok ? (
          <VoteBoard qr={qr} initialRounds={result.data} />
        ) : (
          <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg">
            {t(`errors.${knownErrors.has(result.error) ? result.error : "generic"}`)}
          </p>
        )}
      </main>
    </div>
  );
}
