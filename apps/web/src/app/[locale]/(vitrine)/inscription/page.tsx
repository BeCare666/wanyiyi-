import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Container } from "@/components/ui/Container";
import { redirect } from "@/i18n/navigation";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { RegisterForm } from "./RegisterForm";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Register" });
  return { title: t("eyebrow"), robots: { index: false } };
}

/**
 * Inscription (section 6.2-2) : les étapes du parcours, puis le formulaire.
 * Déjà membre : direction l'espace. Compte créé sans profil (inscription interrompue) :
 * reprise à l'identité.
 */
export default async function RegisterPage() {
  const t = await getTranslations("Register");
  const steps = t.raw("steps") as string[];
  const member = await getSessionMember();
  let initialStep: "account" | "identity" = "account";
  if (member) {
    const supabase = await createSupabaseServer();
    const { data } = (await supabase?.from("member_profiles").select("user_id").eq("user_id", member.id).maybeSingle()) ?? { data: null };
    if (data) return redirect({ href: "/espace", locale: await getLocale() });
    initialStep = "identity";
  }

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
          <ol className="mt-10 border-t border-line">
            {steps.map((step, i) => (
              <li key={step} className="grid grid-cols-[3rem_1fr] items-baseline gap-4 border-b border-line py-5">
                <span aria-hidden="true" className="font-serif text-2xl font-light text-fg-muted">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </header>

        <div className="lg:col-span-6 lg:col-start-7">
          <RegisterForm initialStep={initialStep} />
        </div>
      </Container>
    </section>
  );
}
