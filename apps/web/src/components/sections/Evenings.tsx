import { getTranslations } from "next-intl/server";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { EditorialImage } from "@/components/ui/EditorialImage";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { vitrinePhotos } from "@/config/photos";
import { sectionIds } from "@/config/site";

type Step = { label: string; text: string };

/** Les soirées : grande photo à gauche, déroulement en liste à filets à droite. */
export async function Evenings() {
  const t = await getTranslations("Evenings");
  const steps = t.raw("steps") as Step[];

  return (
    <section id={sectionIds.evenings} aria-labelledby="evenings-title" className="py-section">
      <Container className="grid gap-14 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <EditorialImage
            src={vitrinePhotos.evening.src}
            alt={t("imageAlt")}
            credit={vitrinePhotos.evening.credit}
            caption={t("eyebrow")}
            sizes="(min-width: 1024px) 40vw, 100vw"
            frameClassName="aspect-[4/5]"
            className="lg:sticky lg:top-32"
          />
        </div>

        <div className="lg:col-span-6 lg:col-start-7">
          <Reveal>
            <SectionHeading id="evenings-title" eyebrow={t("eyebrow")} title={t("title")} />
            <p className="mt-8 max-w-measure text-lg text-fg-muted">{t("intro")}</p>
          </Reveal>

          <dl className="mt-14 border-t border-line">
            {steps.map((step, i) => (
              <Reveal key={step.label} delay={i * 0.06} className="grid gap-2 border-b border-line py-8 sm:grid-cols-[11rem_1fr] sm:gap-8">
                <dt className="eyebrow pt-1 text-fg">{step.label}</dt>
                <dd className="text-fg-muted">{step.text}</dd>
              </Reveal>
            ))}
          </dl>

          <Reveal className="mt-12 grid gap-6 sm:grid-cols-2">
            <p className="border-l border-accent pl-5 text-sm text-fg-muted">{t("venue")}</p>
            <p className="border-l border-accent pl-5 text-sm text-fg-muted">{t("themes")}</p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
