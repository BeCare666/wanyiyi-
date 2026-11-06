import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getStaffMember } from "@/lib/staff";
import { DEFAULT_PRICE_XOF, SATURDAY_MONTHS } from "../evenings";
import { loadEventOptions } from "../options";
import { SaturdaysForm } from "./SaturdaysForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.evenings.saturdays");
  return { title: t("title") };
}

/**
 * Programmation des samedis (demande du 06/11/2026) : une soirée publiée chaque samedi pendant
 * 10 mois, 15 femmes et 15 hommes, 20 000 FCFA, à l'heure et au lieu choisis une fois. Chaque
 * soirée reste modifiable ensuite depuis sa fiche.
 */
export default async function SaturdaysPage() {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("events.manage")) notFound();
  const t = await getTranslations("Admin");
  const { venues } = await loadEventOptions();

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/soirees" className="text-sm text-link underline-offset-4 hover:underline">
        {t("evenings.back")}
      </Link>
      <header className="mt-6">
        <p className="eyebrow">{t("groups.evenings")}</p>
        <h1 className="mt-4 text-4xl">{t("evenings.saturdays.title")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("evenings.saturdays.intro")}</p>
      </header>
      <div className="mt-10 border-t border-line pt-10">
        <SaturdaysForm venues={venues} months={SATURDAY_MONTHS} priceXof={DEFAULT_PRICE_XOF} />
      </div>
    </div>
  );
}
