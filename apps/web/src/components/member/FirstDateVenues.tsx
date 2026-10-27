import { getTranslations } from "next-intl/server";

/** Ligne de app.first_date_venues() (question 4). */
export type FirstDateVenue = {
  id: string;
  name: string;
  district: string | null;
  address: string;
  city: string;
  venue_kind: "cafe" | "restaurant" | "other" | null;
  opening_hours: string | null;
};

/**
 * Lieux conseillés pour un premier rendez-vous (question 4, 27 octobre 2026) : lieux publics
 * choisis par l'équipe, montrés aux membres en découverte ou en couple. Simple liste, sans
 * réservation.
 */
export async function FirstDateVenues({ venues }: { venues: FirstDateVenue[] }) {
  if (venues.length === 0) return null;
  const t = await getTranslations("Member.venues");
  return (
    <section aria-labelledby="lieux-conseilles" className="mt-14">
      <h2 id="lieux-conseilles" className="eyebrow">
        {t("title")}
      </h2>
      <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("help")}</p>
      <ul className="mt-4 border-t border-line">
        {venues.map((v) => (
          <li key={v.id} className="grid gap-1 border-b border-line py-5 md:grid-cols-12 md:gap-8">
            <p className="md:col-span-5">
              <span className="font-serif text-xl">{v.name}</span>
              {v.venue_kind && <span className="ml-2 text-sm text-fg-muted">{t(`kinds.${v.venue_kind}`)}</span>}
            </p>
            <p className="text-sm md:col-span-4">
              {[v.address, v.district, v.city].filter(Boolean).join(", ")}
            </p>
            <p className="text-sm text-fg-muted md:col-span-3 md:text-right">{v.opening_hours}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
