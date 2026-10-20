import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MinimalHeader } from "@/components/member/MinimalHeader";
import { ForgotForm } from "./ForgotForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Password");
  return { title: t("forgotTitle"), robots: { index: false } };
}

/** Mot de passe oublié : lien envoyé par l'API (hook de Supabase Auth, via Brevo), valable une fois. */
export default async function ForgotPasswordPage() {
  const t = await getTranslations("Password");

  return (
    <>
      <MinimalHeader />
      <main id="contenu" className="mx-auto max-w-xl px-gutter pb-section pt-16 lg:pt-24">
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("forgotTitle")}
        </p>
        <h1 className="mt-6 text-3xl">{t("forgotIntro")}</h1>
        <ForgotForm />
      </main>
    </>
  );
}
