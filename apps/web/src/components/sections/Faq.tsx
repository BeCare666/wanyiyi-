import { getTranslations } from "next-intl/server";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { sectionIds } from "@/config/site";
import { FaqAccordion } from "./FaqAccordion";

type Item = { q: string; a: string };

/** Questions fréquentes : titre à gauche, accordéon à droite. */
export async function Faq() {
  const t = await getTranslations("Faq");
  const items = t.raw("items") as Item[];

  return (
    <section id={sectionIds.faq} aria-labelledby="faq-title" className="border-t border-line bg-bg-soft py-section">
      <Container className="grid gap-14 lg:grid-cols-12 lg:gap-10">
        <Reveal className="lg:col-span-4">
          <SectionHeading id="faq-title" eyebrow={t("eyebrow")} title={t("title")} />
        </Reveal>
        <Reveal className="lg:col-span-7 lg:col-start-6">
          <FaqAccordion items={items} />
        </Reveal>
      </Container>
    </section>
  );
}
