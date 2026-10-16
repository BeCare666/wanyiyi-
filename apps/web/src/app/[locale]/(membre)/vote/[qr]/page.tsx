import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { MinimalHeader } from "@/components/member/MinimalHeader";
import { redirect } from "@/i18n/navigation";
import { memberApi } from "@/lib/api";
import { signInHref } from "@/lib/next-path";
import { getSessionMember } from "@/lib/session";
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
  const result = await memberApi<Round[]>(`/vote/${qr}`);

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
