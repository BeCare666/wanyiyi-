import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentPage } from "@/components/sections/ContentPage";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Rules" });
  return { title: t("eyebrow") };
}

export default async function RulesPage() {
  return <ContentPage namespace="Rules" />;
}
