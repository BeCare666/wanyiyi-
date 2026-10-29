import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProviderCards } from "@/components/sections/ProviderCards";
import { Container } from "@/components/ui/Container";
import { Link } from "@/i18n/navigation";
import { shouldShowDemoData } from "@/lib/evenings";
import type { ProviderCategory, PublicProvider } from "@/lib/providers";
import { createSupabaseServer } from "@/lib/supabase/server";
import { pageAlternates } from "@/lib/seo";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Providers" });
  return { title: t("title"), alternates: pageAlternates(locale, "/prestataires") };
}

/**
 * Prestataires partenaires sur la vitrine (phase 4, question 2 b) : nom, catégorie, image,
 * courte description et ville, sans compte. Les coordonnées sont réservées aux membres en couple
 * ou unis. Prestataires de démonstration montrés seulement si SHOW_DEMO_DATA le permet.
 */
export default async function ProvidersPage() {
  const t = await getTranslations("Providers");
  const supabase = await createSupabaseServer();
  const [providers, categories] = supabase
    ? await Promise.all([
        supabase.rpc("public_providers", { p_include_demo: shouldShowDemoData() }),
        supabase.from("provider_categories").select("key, name, position, is_active"),
      ])
    : [null, null];

  return (
    <article className="pb-section pt-36 lg:pt-44">
      <Container>
        <header className="max-w-4xl">
          <p className="eyebrow flex items-center gap-4">
            <span aria-hidden="true" className="block h-px w-10 bg-accent" />
            {t("eyebrow")}
          </p>
          <h1 className="mt-8 text-4xl">{t("title")}</h1>
          <p className="mt-8 max-w-measure text-lg text-fg-muted">{t("intro")}</p>
          <p className="mt-6 max-w-measure text-fg-muted">
            {t("contactsNotice")}{" "}
            <Link href="/espace/prestataires" className="text-link underline-offset-4 hover:underline">
              {t("memberLink")}
            </Link>
          </p>
        </header>
        {!providers || providers.error ? (
          <p role="status" className="mt-14 border-t border-line pt-8 text-fg-muted">
            {t("unavailable")}
          </p>
        ) : (
          <ProviderCards rows={(providers.data ?? []) as PublicProvider[]} categories={(categories?.data ?? []) as ProviderCategory[]} />
        )}
      </Container>
    </article>
  );
}
