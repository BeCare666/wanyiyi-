import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";

type Section = { title: string; paragraphs: string[] };

type ContentNamespace = "About" | "Rules" | "Privacy" | "Legal";

/**
 * Page de contenu éditorial (À propos, Règlement, Confidentialité, Mentions légales).
 * Titres de section à gauche, texte à droite, filets fins entre les sections.
 */
export async function ContentPage({ namespace, children }: { namespace: ContentNamespace; children?: ReactNode }) {
  const t = await getTranslations(namespace);
  const sections = t.raw("sections") as Section[];
  const intro = t.has("intro") ? t("intro") : null;

  return (
    <article className="pb-section pt-36 lg:pt-44">
      <Container>
        <header className="max-w-4xl">
          <p className="eyebrow flex items-center gap-4">
            <span aria-hidden="true" className="block h-px w-10 bg-accent" />
            {t("eyebrow")}
          </p>
          <h1 className="mt-8 text-4xl">{t("title")}</h1>
          {intro && <p className="mt-8 max-w-measure text-lg text-fg-muted">{intro}</p>}
        </header>

        <div className="mt-20 border-t border-line">
          {sections.map((section) => (
            <Reveal key={section.title} className="grid gap-6 border-b border-line py-12 lg:grid-cols-12 lg:gap-10">
              <h2 className="text-2xl lg:col-span-4">{section.title}</h2>
              <div className="space-y-4 text-fg-muted lg:col-span-7 lg:col-start-6">
                {section.paragraphs.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
            </Reveal>
          ))}
        </div>
        {children}
      </Container>
    </article>
  );
}
