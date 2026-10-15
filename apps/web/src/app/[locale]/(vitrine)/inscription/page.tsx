import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Container } from "@/components/ui/Container";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Register" });
  return { title: t("eyebrow"), robots: { index: false } };
}

/**
 * Page provisoire de la phase 1 : présente les étapes de l'inscription.
 * Le parcours réel (OTP, pièce d'identité, entretien, déclaration, paiement) arrive en phase 2.
 */
export default async function RegisterPage() {
  const t = await getTranslations("Register");
  const steps = t.raw("steps") as string[];

  return (
    <section className="pb-section pt-36 lg:pt-44">
      <Container className="grid gap-16 lg:grid-cols-12 lg:gap-10">
        <header className="lg:col-span-5">
          <p className="eyebrow flex items-center gap-4">
            <span aria-hidden="true" className="block h-px w-10 bg-accent" />
            {t("eyebrow")}
          </p>
          <h1 className="mt-8 text-4xl">{t("title")}</h1>
          <p className="mt-8 max-w-measure text-lg text-fg-muted">{t("intro")}</p>
        </header>

        <div className="lg:col-span-6 lg:col-start-7">
          <ol className="border-t border-line">
            {steps.map((step, i) => (
              <li key={step} className="grid grid-cols-[4rem_1fr] items-baseline gap-4 border-b border-line py-7">
                <span aria-hidden="true" className="font-serif text-3xl font-light text-fg-muted">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-lg">{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-10 border-l border-accent pl-5 text-fg-muted">{t("notice")}</p>
          <ButtonLink href="/contact" variant="secondary" className="mt-8">
            {t("contactCta")}
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}
