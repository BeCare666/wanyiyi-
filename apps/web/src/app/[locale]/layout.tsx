import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { RevealScript } from "@/components/motion/RevealScript";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { publicMessages } from "@/i18n/client-messages";
import { routing } from "@/i18n/routing";
import { display, text } from "@/lib/fonts";
import "../globals.css";

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: "#faf7f2",
  width: "device-width",
  initialScale: 1,
  // Barre mobile du bas : occupe la zone sûre des écrans à encoche
  viewportFit: "cover",
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  return {
    metadataBase: new URL(siteUrl),
    title: { default: t("title"), template: `%s · ${t("siteName")}` },
    description: t("description"),
    applicationName: t("siteName"),
    alternates: {
      canonical: locale === routing.defaultLocale ? "/" : `/${locale}`,
      languages: { fr: "/", en: "/en", yo: "/yo" },
    },
    openGraph: {
      type: "website",
      siteName: t("siteName"),
      title: t("title"),
      description: t("description"),
      locale,
    },
    formatDetection: { telephone: false },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "Common" });
  const messages = await getMessages({ locale });

  return (
    <html
      lang={locale}
      className={`${display.variable} ${text.variable}`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <RevealScript />
      </head>
      <body>
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-ink focus:px-4 focus:py-3 focus:text-ivory"
        >
          {t("skipToContent")}
        </a>
        {/* Textes des espaces privés : fournis par leur propre mise en page */}
        <NextIntlClientProvider messages={publicMessages(messages)}>{children}</NextIntlClientProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
