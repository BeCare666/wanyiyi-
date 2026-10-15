import { getFormatter, getTranslations } from "next-intl/server";
import { Reveal } from "@/components/motion/Reveal";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { sectionIds } from "@/config/site";
import { demoUpcomingEvenings, seatsLeft, shouldShowDemoData } from "@/lib/evenings";

/** Prochaines soirées : liste éditoriale (date en grand, thème, places par sexe, action). */
export async function Upcoming() {
  const t = await getTranslations("Upcoming");
  const format = await getFormatter();
  const showDemo = shouldShowDemoData();
  const evenings = showDemo ? demoUpcomingEvenings() : [];

  return (
    <section id={sectionIds.upcoming} aria-labelledby="upcoming-title" className="py-section">
      <Container>
        <Reveal className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHeading id="upcoming-title" eyebrow={t("eyebrow")} title={t("title")} />
          <p className="max-w-xs text-sm text-fg-muted">{t("membersOnly")}</p>
        </Reveal>

        {evenings.length === 0 ? (
          <p className="mt-14 border-y border-line py-12 text-center font-serif text-2xl italic text-fg-muted">
            {t("empty")}
          </p>
        ) : (
          <>
            <ul className="mt-14 border-t border-line">
              {evenings.map((evening, i) => {
                const date = new Date(evening.startsAt);
                const women = seatsLeft(evening.capacityWomen, evening.bookedWomen);
                const men = seatsLeft(evening.capacityMen, evening.bookedMen);
                const full = women === 0 && men === 0;
                return (
                  <Reveal
                    as="li"
                    key={evening.id}
                    delay={i * 0.06}
                    className="grid gap-6 border-b border-line py-8 md:grid-cols-12 md:items-center md:gap-8"
                  >
                    <div className="md:col-span-4">
                      <p className="font-serif text-3xl first-letter:uppercase">
                        {format.dateTime(date, "eventDay")}
                      </p>
                      <p className="mt-1 text-sm text-fg-muted">{format.dateTime(date, "eventTime")}</p>
                    </div>
                    <p className="eyebrow text-fg md:col-span-3">{t(`themes.${evening.theme}`)}</p>
                    <dl className="flex gap-10 text-sm md:col-span-3">
                      <div>
                        <dt className="text-fg-muted">{t("women")}</dt>
                        <dd className="mt-1 font-medium">{t("seatsLeft", { count: women })}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">{t("men")}</dt>
                        <dd className="mt-1 font-medium">{t("seatsLeft", { count: men })}</dd>
                      </div>
                    </dl>
                    <div className="md:col-span-2 md:text-right">
                      <ButtonLink href="/inscription" variant="secondary" className="w-full md:w-auto">
                        {full ? t("waitlist") : t("book")}
                      </ButtonLink>
                    </div>
                  </Reveal>
                );
              })}
            </ul>
            {showDemo && (
              <p className="mt-6 text-xs uppercase tracking-[0.16em] text-fg-muted">{t("demoNotice")}</p>
            )}
          </>
        )}
      </Container>
    </section>
  );
}
