import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { memberNav } from "@/components/member/memberNav";
import { MinimalHeader } from "@/components/member/MinimalHeader";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { redirect } from "@/i18n/navigation";
import { memberApi } from "@/lib/api";
import { signInHref } from "@/lib/next-path";
import { getSessionMember } from "@/lib/session";
import { type CheckoutInfo, widgetOptions } from "./checkout";
import { KkiapayCheckout } from "./KkiapayCheckout";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Payment");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Page de paiement KkiaPay (question 7 réglée le 20 octobre 2026), ouverte par l'API après la
 * réservation d'une soirée : montant, puis widget officiel. Paiement d'un autre membre : introuvable.
 */
export default async function PaymentPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const member = await getSessionMember();
  if (!member) return redirect({ href: signInHref(`/paiement/${id}`), locale: await getLocale() });
  const t = await getTranslations("Payment");
  const format = await getFormatter();
  const result = await memberApi<CheckoutInfo>(`/payments/${id}`);
  if (!result.ok && result.error === "not_found") notFound();
  const info = result.ok ? result.data : null;
  const options = info ? widgetOptions(info) : null;

  return (
    <div data-theme={member.darkMode ? "dark" : undefined} className="min-h-svh bg-bg text-fg">
      <MinimalHeader />
      <main id="contenu" className="mx-auto max-w-xl px-gutter pb-section pt-10">
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("eyebrow")}
        </p>
        <h1 className="mt-6 text-3xl">{t("title")}</h1>
        {!info ? (
          <p role="alert" className="mt-8 border-l border-accent pl-5">
            {t("errors.unavailable")}
          </p>
        ) : (
          <>
            <p className="mt-6 font-serif text-4xl tabular-nums">
              {format.number(info.amountXof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 })}
            </p>
            <p className="mt-3 text-fg-muted">{t(`purposes.${info.purpose === "registration_fee" ? "registration_fee" : "evening_booking"}`)}</p>
            {options ? (
              <>
                <p className="mt-6 text-fg-muted">{t("intro")}</p>
                {options.sandbox && <p className="mt-3 text-sm text-fg-muted">{t("sandbox")}</p>}
                <KkiapayCheckout paymentId={info.paymentId} options={options} />
              </>
            ) : (
              <>
                <p role="status" className="mt-8 border-l border-fg pl-5">
                  {t(`statuses.${info.status === "pending" ? "unavailable" : info.status}`)}
                </p>
                <ButtonLink href={memberNav.evenings.href} variant="secondary" className="mt-8 w-full">
                  {t("back")}
                </ButtonLink>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
