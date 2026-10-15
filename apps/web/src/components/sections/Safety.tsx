import {
  ChatsCircleIcon,
  EyeSlashIcon,
  FlagIcon,
  SealCheckIcon,
  UserFocusIcon,
} from "@phosphor-icons/react/ssr";
import type { Icon } from "@phosphor-icons/react";
import { getTranslations } from "next-intl/server";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { sectionIds } from "@/config/site";

type Item = { title: string; text: string };

// Une icône par engagement, dans l'ordre du fichier de traduction
const icons: Icon[] = [SealCheckIcon, EyeSlashIcon, UserFocusIcon, ChatsCircleIcon, FlagIcon];

/** Votre sécurité : section bleu nuit, ton rassurant, liste à filets. */
export async function Safety() {
  const t = await getTranslations("Safety");
  const items = t.raw("items") as Item[];

  return (
    <section
      id={sectionIds.safety}
      aria-labelledby="safety-title"
      className="surface-night bg-night py-section text-ivory"
    >
      <Container className="grid gap-14 lg:grid-cols-12 lg:gap-10">
        <Reveal className="lg:col-span-5">
          <div className="lg:sticky lg:top-32">
            <SectionHeading id="safety-title" eyebrow={t("eyebrow")} title={t("title")} tone="inverse" />
            <p className="mt-8 max-w-md text-lg text-silver">{t("intro")}</p>
          </div>
        </Reveal>

        <ul className="border-t border-line lg:col-span-6 lg:col-start-7">
          {items.map((item, i) => {
            const ItemIcon = icons[i] ?? SealCheckIcon;
            return (
              <Reveal as="li" key={item.title} delay={i * 0.06} className="grid grid-cols-[2.5rem_1fr] gap-5 border-b border-line py-9">
                <ItemIcon size={28} weight="light" aria-hidden="true" className="mt-1 text-accent" />
                <div>
                  <h3 className="text-2xl">{item.title}</h3>
                  <p className="mt-3 max-w-measure text-silver">{item.text}</p>
                </div>
              </Reveal>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
