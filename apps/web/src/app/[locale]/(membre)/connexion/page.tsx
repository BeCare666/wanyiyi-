import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { MinimalHeader } from "@/components/member/MinimalHeader";
import { redirect } from "@/i18n/navigation";
import { safeNextPath } from "@/lib/next-path";
import { getSessionMember } from "@/lib/session";
import { SignInForm } from "./SignInForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SignIn");
  return { title: t("title"), robots: { index: false } };
}

type Props = { searchParams: Promise<{ suite?: string | string[] }> };

/** Connexion d'un membre existant (code OTP par SMS), puis retour à la page demandée. */
export default async function SignInPage({ searchParams }: Props) {
  const next = safeNextPath((await searchParams).suite);
  if (await getSessionMember()) return redirect({ href: next, locale: await getLocale() });
  const t = await getTranslations("SignIn");

  return (
    <>
      <MinimalHeader />
      <main id="contenu" className="mx-auto max-w-xl px-gutter pb-section pt-16 lg:pt-24">
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("title")}
        </p>
        <h1 className="mt-6 text-3xl">{t("intro")}</h1>
        <SignInForm next={next} />
      </main>
    </>
  );
}
