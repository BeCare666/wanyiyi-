import { PROFILE_CATALOG } from "@wanyiyi/shared";
import type { ThemeName } from "../../../../../lib/theme-name";

export { themeName } from "../../../../../lib/theme-name";

/**
 * Thèmes des soirées (questions 4 et 21, choix du 24 octobre 2026) : nom en trois langues,
 * âge, confessions et secteurs pris dans le catalogue du profil.
 */

const optionsOf = (key: string): readonly string[] => PROFILE_CATALOG.find((c) => c.key === key)?.options ?? [];

/** Confessions proposées : celles du profil, sauf « autre » et « aucune ». */
export const themeReligions = optionsOf("religion").filter((r) => r !== "other" && r !== "none");
/** Secteurs proposés : ceux du profil (question 4). */
export const themeSectors = optionsOf("sector");

export type ThemeInput = {
  name: ThemeName;
  minAge: string;
  maxAge: string;
  religions: string[];
  sectors: string[];
};

export type ThemeRow = {
  id: string;
  key: string;
  name: Partial<ThemeName> | null;
  min_age: number | null;
  max_age: number | null;
  required_religions: string[] | null;
  sectors: string[] | null;
};

export type ThemeError = "name" | "age" | "criteria";

const AGE = /^\d{2,3}$/;

/** Âge saisi : vide (sans borne) ou nombre entier de 18 à 120 ; undefined si invalide. */
export function parseAge(value: string): number | null | undefined {
  const v = value.trim();
  if (v === "") return null;
  if (!AGE.test(v)) return undefined;
  const age = Number(v);
  return age >= 18 && age <= 120 ? age : undefined;
}

/** Mêmes contrôles que app.save_theme, avant l'envoi. */
export function checkTheme(input: ThemeInput): ThemeError | null {
  if (input.name.fr.trim() === "" || Object.values(input.name).some((n) => n.length > 80)) return "name";
  const min = parseAge(input.minAge);
  const max = parseAge(input.maxAge);
  if (min === undefined || max === undefined || (min !== null && max !== null && max < min)) return "age";
  const religions = input.religions.filter((r) => themeReligions.includes(r));
  const sectors = input.sectors.filter((s) => themeSectors.includes(s));
  if (min === null && max === null && religions.length === 0 && sectors.length === 0) return "criteria";
  return null;
}

/** Paramètres de app.save_theme (valeurs hors catalogue écartées). */
export function themeParams(input: ThemeInput) {
  return {
    p_name: { fr: input.name.fr.trim(), en: input.name.en.trim(), yo: input.name.yo.trim() },
    p_min_age: parseAge(input.minAge) ?? null,
    p_max_age: parseAge(input.maxAge) ?? null,
    p_religions: input.religions.filter((r) => themeReligions.includes(r)),
    p_sectors: input.sectors.filter((s) => themeSectors.includes(s)),
  };
}

/** Colonnes du fichier exporté de la liste des thèmes (11.3). */
export const themeExportColumns = ["name", "min_age", "max_age", "religions", "sectors", "events", "created_at"] as const;
export type ThemeExportColumn = (typeof themeExportColumns)[number];
export type ThemeListRow = ThemeRow & { events: number; created_at: string; total: number };

export function themeExportCell(
  row: ThemeListRow,
  column: ThemeExportColumn,
  labels: { name: (row: ThemeRow) => string; religion: (r: string) => string; sector: (s: string) => string; date: (iso: string) => string },
): string | number | null {
  switch (column) {
    case "name":
      return labels.name(row);
    case "min_age":
      return row.min_age;
    case "max_age":
      return row.max_age;
    case "religions":
      return (row.required_religions ?? []).map(labels.religion).join(", ") || null;
    case "sectors":
      return (row.sectors ?? []).map(labels.sector).join(", ") || null;
    case "events":
      return row.events;
    case "created_at":
      return labels.date(row.created_at);
  }
}
