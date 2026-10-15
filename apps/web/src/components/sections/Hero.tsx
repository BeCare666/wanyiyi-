import { ArrowRightIcon } from "@phosphor-icons/react/ssr";
import { getTranslations } from "next-intl/server";
import { Reveal } from "@/components/motion/Reveal";
import { SlowZoomImage } from "@/components/motion/SlowZoomImage";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Container } from "@/components/ui/Container";
import { vitrinePhotos } from "@/config/photos";
import { sectionIds } from "@/config/site";

/** Ouverture : titre serif, promesse, deux actions, puis photo pleine largeur. */
export async function Hero() {
  const t = await getTranslations();

  return (
    <section aria-labelledby="hero-title" className="pt-28 lg:pt-36">
      <Container className="grid gap-10 pb-12 lg:grid-cols-12 lg:items-end lg:pb-16">
        <div className="lg:col-span-8">
          <p className="eyebrow flex items-center gap-4">
            <span aria-hidden="true" className="block h-px w-10 bg-accent" />
            {t("Hero.eyebrow")}
          </p>
          <h1 id="hero-title" className="mt-8 text-5xl">
            {t("Hero.title")}
          </h1>
        </div>
        <Reveal className="lg:col-span-4" delay={0.15}>
          <p className="max-w-sm text-lg text-fg-muted">{t("Hero.promise")}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <ButtonLink href="/inscription">{t("Common.becomeMember")}</ButtonLink>
            <ButtonLink href={`/#${sectionIds.upcoming}`} variant="secondary">
              {t("Common.nextEvening")}
              <ArrowRightIcon size={16} weight="light" aria-hidden="true" />
            </ButtonLink>
          </div>
        </Reveal>
      </Container>

      <figure>
        <div className="relative h-[62svh] min-h-96 overflow-hidden bg-stone-200 lg:h-[80svh]">
          <SlowZoomImage
            src={vitrinePhotos.hero.src}
            alt={t("Hero.imageAlt")}
            priority
            sizes="100vw"
            quality={75}
            className="photo-tone object-cover object-[50%_60%]"
          />
        </div>
        <Container>
          <figcaption className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-[0.6875rem] uppercase tracking-[0.16em] text-fg-muted">
            <span aria-hidden="true" className="block h-px w-10 self-center bg-accent" />
            <span className="normal-case italic tracking-normal">{t("Common.photoCredit", { name: vitrinePhotos.hero.credit })}</span>
          </figcaption>
        </Container>
      </figure>
    </section>
  );
}
