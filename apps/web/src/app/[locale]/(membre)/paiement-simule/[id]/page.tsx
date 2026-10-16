import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { MinimalHeader } from "@/components/member/MinimalHeader";
import { redirect } from "@/i18n/navigation";
import { signInHref } from "@/lib/next-path";
import { getSessionMember } from "@/lib/session";
import { SimulatedCheckout } from "./SimulatedCheckout";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SimulatedPayment");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Page de paiement de démonstration, ouverte par l'adaptateur « simulé » de l'API
 * en attendant le prestataire réel (PHASE2.txt, question 7). Aucun argent n'est débité ;
 * l'API refuse cette validation en production.
 */
export default async function SimulatedPaymentPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const member = await getSessionMember();
  if (!member) return redirect({ href: signInHref(`/paiement-simule/${id}`), locale: await getLocale() });
  const t = await getTranslations("SimulatedPayment");

  return (
    <div data-theme={member.darkMode ? "dark" : undefined} className="min-h-svh bg-bg text-fg">
      <MinimalHeader />
      <main id="contenu" className="mx-auto max-w-xl px-gutter pb-section pt-10">
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("eyebrow")}
        </p>
        <h1 className="mt-6 text-3xl">{t("title")}</h1>
        <p className="mt-5 text-fg-muted">{t("intro")}</p>
        <SimulatedCheckout paymentId={id} />
      </main>
    </div>
  );
}
