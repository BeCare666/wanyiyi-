/** Nom d'un thème de soirée en trois langues (questions 4 et 21, 24 octobre 2026). */
export type ThemeName = { fr: string; en: string; yo: string };

/** Nom du thème dans la langue affichée, en français à défaut, puis sa clé. */
export function themeName(theme: { key: string; name?: Partial<ThemeName> | null }, locale: string): string {
  const name = theme.name ?? {};
  return name[locale as keyof ThemeName] || name.fr || theme.key;
}
