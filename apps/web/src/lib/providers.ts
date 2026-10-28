/**
 * Prestataires (phase 4, question 2 de PROPOSITIONS-QUESTIONS-PHASE4.txt, validée le 27 octobre
 * 2026). Logique pure partagée par l'administration, la vitrine et l'espace membre ; mêmes
 * contrôles que app.admin_save_provider (migration 20261028000100).
 */

export type Locale = "fr" | "en" | "yo";
export const providerLocales: readonly Locale[] = ["fr", "en", "yo"];
export type Localized = Partial<Record<Locale, string>>;

export type ProviderInput = {
  name: string;
  category: string;
  description: Localized;
  phone: string;
  whatsapp: string;
  city: string;
  district: string;
  priceRange: string;
  isDemo: boolean;
};

export type ProviderError = "name" | "category" | "description" | "description_length" | "phone" | "contact" | "place" | "price_range";

const PHONE = /^\+?[0-9]{8,15}$/;
export const DESCRIPTION_MAX = 600;

/** Numéro saisi avec ou sans espaces : chiffres seulement, « + » initial permis. */
export function cleanPhone(raw: string): string {
  return raw.replace(/\s/g, "");
}

export function checkProvider(input: ProviderInput): ProviderError | null {
  if (input.name.trim() === "" || input.name.trim().length > 120) return "name";
  if (input.category === "") return "category";
  if ((input.description.fr ?? "").trim() === "") return "description";
  if (providerLocales.some((l) => (input.description[l] ?? "").trim().length > DESCRIPTION_MAX)) return "description_length";
  const phone = cleanPhone(input.phone);
  const whatsapp = cleanPhone(input.whatsapp);
  if ((phone !== "" && !PHONE.test(phone)) || (whatsapp !== "" && !PHONE.test(whatsapp))) return "phone";
  if (phone === "" && whatsapp === "") return "contact";
  if (input.city.trim() === "" || input.city.trim().length > 80 || input.district.trim().length > 80) return "place";
  if (input.priceRange.trim().length > 80) return "price_range";
  return null;
}

/** Texte dans la langue affichée, en français à défaut. */
export function localized(value: Localized | null | undefined, locale: string): string {
  if (!value) return "";
  return (value[locale as Locale] ?? "").trim() || (value.fr ?? "");
}

/** Lien WhatsApp (wa.me) : chiffres seulement, sans « + ». */
export function whatsappLink(number: string): string {
  return `https://wa.me/${cleanPhone(number).replace(/^\+/, "")}`;
}

/** Ligne de app.public_providers() (vitrine, sans coordonnées). */
export type PublicProvider = { id: string; name: string; category: string; description: Localized | null; image_url: string | null; city: string };

/** Ligne de app.member_providers() (couples et unions : coordonnées complètes). */
export type MemberProvider = PublicProvider & {
  district: string | null;
  phone: string | null;
  whatsapp: string | null;
  price_range: string | null;
  i_contacted: boolean;
};

/** Catégorie (table provider_categories, lisible de tous). */
export type ProviderCategory = { key: string; name: Localized; position: number; is_active: boolean };

/** Prestataires regroupés par catégorie active, dans l'ordre des catégories ; catégories vides retirées. */
export function groupByCategory<T extends { category: string }>(rows: readonly T[], categories: readonly ProviderCategory[]): { category: ProviderCategory; rows: T[] }[] {
  return [...categories]
    .filter((c) => c.is_active)
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
    .map((category) => ({ category, rows: rows.filter((r) => r.category === category.key) }))
    .filter((g) => g.rows.length > 0);
}

/** Ligne de la liste filtrable « providers » (app.list_rows_sql). */
export type ProviderListRow = {
  id: string;
  name: string;
  category: string;
  city: string;
  district: string | null;
  phone: string | null;
  whatsapp: string | null;
  price_range: string | null;
  image_url: string | null;
  is_active: boolean;
  is_demo: boolean;
  created_at: string;
  contacts: number;
  total: number;
};

/** Colonnes du fichier exporté (11.3). */
export const providerExportColumns = ["name", "category", "city", "district", "phone", "whatsapp", "price_range", "is_active", "is_demo", "contacts", "created_at"] as const;
export type ProviderExportColumn = (typeof providerExportColumns)[number];

export function providerExportCell(
  row: ProviderListRow,
  column: ProviderExportColumn,
  labels: { yesNo: (b: boolean) => string; date: (iso: string) => string; category: (key: string) => string },
): string | number | null {
  switch (column) {
    case "category":
      return labels.category(row.category);
    case "is_active":
    case "is_demo":
      return labels.yesNo(row[column]);
    case "created_at":
      return labels.date(row.created_at);
    default:
      return row[column];
  }
}

/** Clé d'une nouvelle catégorie : minuscules, chiffres et tirets bas, 2 à 40 caractères. */
export function validCategoryKey(key: string): boolean {
  return /^[a-z][a-z0-9_]{1,39}$/.test(key);
}
