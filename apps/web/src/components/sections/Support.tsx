import { getTranslations } from "next-intl/server";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { sectionIds } from "@/config/site";

/** L'accompagnement : trois colonnes asymétriques, puis une citation pleine largeur. */
export async function Support() {
  const t = await getTranslations("Support");
  const blocks = [
    { title: t("discoveryTitle"), text: t("discoveryText") },
    { title: t("counselorTitle"), text: t("counselorText") },
    { title: t("consentTitle"), text: t("consentText") },
  ];

  return (
    <section id={sectionIds.support} aria-labelledby="support-title" className="py-section">
      <Container>
        <Reveal>
          <SectionHeading id="support-title" eyebrow={t("eyebrow")} title={t("title")} />
        </Reveal>

        <div className="mt-16 grid gap-12 border-t border-line pt-12 md:grid-cols-3 md:gap-10">
          {blocks.map((block, i) => (
            <Reveal key={block.title} delay={i * 0.08} className={i === 1 ? "md:pt-16" : i === 2 ? "md:pt-32" : undefined}>
              <h3 className="text-2xl">{block.title}</h3>
              <p className="mt-4 text-fg-muted">{block.text}</p>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <figure className="mx-auto mt-24 max-w-4xl text-center lg:mt-32">
            <span aria-hidden="true" className="mx-auto block h-px w-16 bg-accent" />
            <blockquote className="mt-10 font-serif text-3xl font-light italic leading-snug md:text-4xl">
              {t("quote")}
            </blockquote>
            <span aria-hidden="true" className="mx-auto mt-10 block h-px w-16 bg-accent" />
          </figure>
        </Reveal>
      </Container>
    </section>
  );
}
