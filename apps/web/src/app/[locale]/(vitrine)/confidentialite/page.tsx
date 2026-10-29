import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentPage } from "@/components/sections/ContentPage";
import { pageAlternates } from "@/lib/seo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Privacy" });
  return { title: t("eyebrow"), alternates: pageAlternates(locale, "/confidentialite") };
}

export default async function PrivacyPage() {
  return <ContentPage namespace="Privacy" />;
}
