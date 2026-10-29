import type { Metadata } from "next";
import { routing } from "../i18n/routing";

/** Chemin public d'une page dans une langue : le français reste sans préfixe (/, /en, /yo). */
export function localizedPath(locale: string, path: string): string {
  const clean = path === "/" ? "" : path;
  if (locale === routing.defaultLocale) return clean || "/";
  return `/${locale}${clean}`;
}

/**
 * Adresse canonique et variantes de langue (hreflang) d'une page publique. Sans cela, chaque
 * page hériterait de celles de l'accueil (layout) et serait vue comme un doublon de l'accueil.
 */
export function pageAlternates(locale: string, path: string): Metadata["alternates"] {
  return {
    canonical: localizedPath(locale, path),
    languages: Object.fromEntries(routing.locales.map((l) => [l, localizedPath(l, path)])),
  };
}
