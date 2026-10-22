import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getStaffMember } from "@/lib/staff";
import { DEFAULT_PRICE_XOF, draftDefaults } from "../evenings";
import { EventForm } from "../EventForm";
import { loadEventOptions } from "../options";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.evenings");
  return { title: t("new") };
}

/** Nouvelle soirée : enregistrée en brouillon, invisible des membres jusqu'à la publication. */
export default async function NewEveningPage() {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("events.manage")) notFound();
  const t = await getTranslations("Admin");
  const { venues, themes } = await loadEventOptions();

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/soirees" className="text-sm text-link underline-offset-4 hover:underline">
        {t("evenings.back")}
      </Link>
      <header className="mt-6">
        <p className="eyebrow">{t("groups.evenings")}</p>
        <h1 className="mt-4 text-4xl">{t("evenings.new")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("evenings.newIntro")}</p>
      </header>
      <div className="mt-10 border-t border-line pt-10">
        <EventForm
          eventId={null}
          initial={{ venueId: null, themeId: null, startsAt: "", priceXof: DEFAULT_PRICE_XOF, ...draftDefaults }}
          venues={venues}
          themes={themes}
        />
      </div>
    </div>
  );
}
