import { WifiSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/Logo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Offline" });
  return { title: t("title"), robots: { index: false } };
}

/**
 * Écran hors ligne, mis en cache par le service worker.
 * Il fonctionne sans JavaScript : le bouton est un simple lien de rechargement.
 */
export default async function OfflinePage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations("Offline");
  const home = locale === "fr" ? "/" : `/${locale}`;

  return (
    <main id="contenu" className="surface-night flex min-h-svh flex-col items-center justify-center bg-night px-gutter text-center text-ivory">
      <Logo variant="stacked" className="text-ivory" />
      <WifiSlashIcon size={40} weight="thin" aria-hidden="true" className="mt-16 text-accent" />
      <h1 className="mt-8 text-4xl">{t("title")}</h1>
      <p className="mt-6 max-w-sm text-silver">{t("text")}</p>
      <a
        href={home}
        className="mt-10 inline-flex min-h-12 items-center rounded-sm border border-ivory/70 px-7 text-xs font-medium uppercase tracking-[0.16em]"
      >
        {t("retry")}
      </a>
    </main>
  );
}
