import { getTranslations } from "next-intl/server";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { EditorialImage } from "@/components/ui/EditorialImage";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { vitrinePhotos } from "@/config/photos";
import { sectionIds } from "@/config/site";

type Item = { title: string; text: string };

/** La célébration : texte à gauche, photo à droite (alternance avec Les soirées). */
export async function Celebration() {
  const t = await getTranslations("Celebration");
  const items = t.raw("items") as Item[];

  return (
    <section id={sectionIds.celebration} aria-labelledby="celebration-title" className="border-t border-line bg-bg-soft py-section">
      <Container className="grid gap-14 lg:grid-cols-12 lg:items-center lg:gap-10">
        <div className="lg:col-span-6">
          <Reveal>
            <SectionHeading id="celebration-title" eyebrow={t("eyebrow")} title={t("title")} />
            <p className="mt-8 max-w-measure text-lg text-fg-muted">{t("intro")}</p>
          </Reveal>
          <ul className="mt-12 border-t border-line">
            {items.map((item, i) => (
              <Reveal as="li" key={item.title} delay={i * 0.06} className="border-b border-line py-7">
                <h3 className="text-xl">{item.title}</h3>
                <p className="mt-2 max-w-measure text-fg-muted">{item.text}</p>
              </Reveal>
            ))}
          </ul>
        </div>

        <EditorialImage
          src={vitrinePhotos.celebration.src}
          alt={t("imageAlt")}
          credit={vitrinePhotos.celebration.credit}
          caption={t("eyebrow")}
          sizes="(min-width: 1024px) 40vw, 100vw"
          frameClassName="aspect-[4/5]"
          imageClassName="object-[50%_20%]"
          className="lg:col-span-5 lg:col-start-8"
        />
      </Container>
    </section>
  );
}
