import { getTranslations } from "next-intl/server";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { sectionIds } from "@/config/site";
import { JourneyTimeline } from "./JourneyTimeline";

type Step = { title: string; text: string };

/** Comment ça se passe : le parcours en ligne de temps animée au défilement. */
export async function Journey() {
  const t = await getTranslations("Journey");
  const steps = t.raw("steps") as Step[];

  return (
    <section id={sectionIds.journey} aria-labelledby="journey-title" className="border-t border-line bg-bg-soft py-section">
      <Container>
        <Reveal>
          <SectionHeading id="journey-title" eyebrow={t("eyebrow")} title={t("title")} className="mx-auto text-center [&_p]:justify-center" />
        </Reveal>
        <JourneyTimeline steps={steps} />
        <Reveal>
          <p className="mx-auto mt-20 max-w-xl border-t border-line pt-8 text-center font-serif text-xl italic text-fg-muted">
            {t("noMatch")}
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
