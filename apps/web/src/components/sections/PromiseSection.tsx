import { getTranslations } from "next-intl/server";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { sectionIds } from "@/config/site";

type Item = { title: string; text: string };

/** La promesse : colonne de titre fixe à gauche, liste à filets et grands chiffres à droite. */
export async function PromiseSection() {
  const t = await getTranslations("Promise");
  const items = t.raw("items") as Item[];

  return (
    <section id={sectionIds.promise} aria-labelledby="promise-title" className="py-section">
      <Container className="grid gap-14 lg:grid-cols-12 lg:gap-10">
        <Reveal className="lg:col-span-5">
          <div className="lg:sticky lg:top-32">
            <SectionHeading id="promise-title" eyebrow={t("eyebrow")} title={t("title")} />
          </div>
        </Reveal>

        <ol className="border-t border-line lg:col-span-6 lg:col-start-7">
          {items.map((item, i) => (
            <Reveal as="li" key={item.title} delay={i * 0.08} className="grid grid-cols-[4.5rem_1fr] gap-4 border-b border-line py-10 sm:grid-cols-[6rem_1fr]">
              <span aria-hidden="true" className="font-serif text-4xl font-light leading-none text-fg-muted">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="text-2xl">{item.title}</h3>
                <p className="mt-4 max-w-measure text-fg-muted">{item.text}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </Container>
    </section>
  );
}
