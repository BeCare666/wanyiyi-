import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { MinimalHeader } from "@/components/member/MinimalHeader";
import { redirect } from "@/i18n/navigation";
import { getSessionMember } from "@/lib/session";
import { NewPasswordForm } from "./NewPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Password");
  return { title: t("newTitle"), robots: { index: false } };
}

/**
 * Nouveau mot de passe : ouverte par le lien « mot de passe oublié » (page /confirmation,
 * qui connecte le membre). Sans session, retour à la demande de lien.
 */
export default async function NewPasswordPage() {
  if (!(await getSessionMember())) return redirect({ href: "/mot-de-passe-oublie", locale: await getLocale() });
  const t = await getTranslations("Password");

  return (
    <>
      <MinimalHeader />
      <main id="contenu" className="mx-auto max-w-xl px-gutter pb-section pt-16 lg:pt-24">
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("newTitle")}
        </p>
        <h1 className="mt-6 text-3xl">{t("newIntro")}</h1>
        <NewPasswordForm />
      </main>
    </>
  );
}
