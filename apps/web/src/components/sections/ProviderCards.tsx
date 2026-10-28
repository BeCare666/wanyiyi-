import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { groupByCategory, localized, type ProviderCategory, type PublicProvider } from "@/lib/providers";

/**
 * Prestataires regroupés par catégorie (phase 4, question 2) : nom, image, courte description,
 * ville. « details » ajoute, pour l'espace membre, les coordonnées et « J'ai contacté ».
 */
export async function ProviderCards<T extends PublicProvider>({
  rows,
  categories,
  details,
}: {
  rows: T[];
  categories: ProviderCategory[];
  details?: (row: T) => ReactNode;
}) {
  const t = await getTranslations("Providers");
  const locale = await getLocale();
  const groups = groupByCategory(rows, categories);

  if (groups.length === 0) return <p className="mt-14 border-t border-line pt-8 text-fg-muted">{t("empty")}</p>;
  return (
    <div className="mt-14">
      {groups.map(({ category, rows: items }) => (
        <section key={category.key} aria-labelledby={`categorie-${category.key}`} className="border-t border-line py-10">
          <h2 id={`categorie-${category.key}`} className="text-2xl">
            {localized(category.name, locale)}
          </h2>
          <ul className="mt-8 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <li key={p.id}>
                {p.image_url ? (
                  <Image
                    src={p.image_url}
                    alt={t("imageAlt", { name: p.name })}
                    width={640}
                    height={480}
                    sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw"
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : (
                  <div aria-hidden="true" className="aspect-[4/3] w-full bg-bg-soft" />
                )}
                <h3 className="mt-4 text-xl">{p.name}</h3>
                <p className="mt-1 text-sm text-fg-muted">{p.city}</p>
                <p className="mt-3 text-fg-muted">{localized(p.description, locale)}</p>
                {details?.(p)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
