import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProviderCards } from "@/components/sections/ProviderCards";
import { Link } from "@/i18n/navigation";
import { shouldShowDemoData } from "@/lib/evenings";
import { type MemberProvider, type ProviderCategory, whatsappLink } from "@/lib/providers";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { ContactedButton } from "./ContactedButton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Providers");
  return { title: t("title") };
}

/**
 * Prestataires avec leurs coordonnées (phase 4, question 2 b et d), pour les membres en couple ou
 * unis seulement (app.member_providers le revérifie). Pas de réservation ni de paiement par
 * Ifedele : le couple contacte le prestataire lui-même.
 */
export default async function MemberProvidersPage() {
  const t = await getTranslations("Providers");
  const member = await getSessionMember();
  const supabase = await createSupabaseServer();
  if (!member || !supabase) return null;

  const [{ data, error }, { data: categories }] = await Promise.all([
    supabase.rpc("member_providers", { p_include_demo: shouldShowDemoData() }),
    supabase.from("provider_categories").select("key, name, position, is_active"),
  ]);
  const reserved = error?.message === "not_in_couple";

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("eyebrow")}
        </p>
        <h1 className="mt-6 font-serif text-4xl">{t("title")}</h1>
        <p className="mt-6 max-w-measure text-lg text-fg-muted">{t("memberIntro")}</p>
      </header>

      {error ? (
        <p role="status" className="mt-14 border-l border-accent pl-5 text-fg-muted">
          {reserved ? t("reserved") : t("unavailable")}{" "}
          {reserved && (
            <Link href="/prestataires" className="text-link underline-offset-4 hover:underline">
              {t("publicLink")}
            </Link>
          )}
        </p>
      ) : (
        <ProviderCards
          rows={(data ?? []) as MemberProvider[]}
          categories={(categories ?? []) as ProviderCategory[]}
          details={(p) => (
            <>
              <dl className="mt-4 grid gap-1 text-sm">
                {p.district && (
                  <div className="flex gap-2">
                    <dt className="text-fg-muted">{t("district")}</dt>
                    <dd>{p.district}</dd>
                  </div>
                )}
                {p.price_range && (
                  <div className="flex gap-2">
                    <dt className="text-fg-muted">{t("priceRange")}</dt>
                    <dd>{p.price_range}</dd>
                  </div>
                )}
                {p.phone && (
                  <div className="flex gap-2">
                    <dt className="text-fg-muted">{t("phone")}</dt>
                    <dd>
                      <a href={`tel:${p.phone}`} className="text-link underline-offset-4 hover:underline">
                        {p.phone}
                      </a>
                    </dd>
                  </div>
                )}
                {p.whatsapp && (
                  <div className="flex gap-2">
                    <dt className="text-fg-muted">{t("whatsapp")}</dt>
                    <dd>
                      <a href={whatsappLink(p.whatsapp)} target="_blank" rel="noopener noreferrer" className="text-link underline-offset-4 hover:underline">
                        {p.whatsapp}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
              <ContactedButton providerId={p.id} contacted={p.i_contacted} />
            </>
          )}
        />
      )}
    </div>
  );
}
