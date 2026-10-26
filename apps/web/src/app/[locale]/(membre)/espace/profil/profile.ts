import { type CatalogCategory, INDIFFERENT, PROFILE_CATALOG, RULES } from "@wanyiyi/shared";

/**
 * Profil (section 8 de la note) : « Je me décris » et « Ce que je recherche », formulaire en étapes
 * avec barre de progression, étiquettes sélectionnables, enregistrement automatique.
 * « Ce que je recherche » reprend les mêmes catégories, en choix multiples avec « Indifférent » ;
 * au maximum 3 critères non négociables.
 */

export const sides = ["self", "seeking"] as const;
export type Side = (typeof sides)[number];

export const textFields = ["who_i_am", "what_matters", "evening_topic"] as const;
export type TextField = (typeof textFields)[number];

/** Étapes : la première (mes mots) n'existe que pour « Je me décris ». */
export const profileSteps = [
  { key: "words", categories: [] },
  { key: "situation", categories: ["marital_status", "children", "wants_children", "intention", "timeline"] },
  { key: "faith", categories: ["religion", "religious_practice"] },
  { key: "work", categories: ["education", "sector", "income"] },
  { key: "appearance", categories: ["languages", "height", "build"] },
  { key: "lifestyle", categories: ["personality", "tobacco", "alcohol", "going_out", "interests"] },
  { key: "after_match", categories: ["money_management", "extended_family", "desired_location"] },
] as const;

export type StepKey = (typeof profileSteps)[number]["key"];

export function stepsFor(side: Side) {
  return side === "self" ? profileSteps : profileSteps.filter((s) => s.key !== "words");
}

const byKey = new Map<string, CatalogCategory>(PROFILE_CATALOG.map((c) => [c.key, c]));

export function categoryOf(key: string): CatalogCategory | undefined {
  return byKey.get(key);
}

/** Réponses du membre : côté, puis catégorie, puis valeurs choisies. */
export type Answers = Record<Side, Record<string, string[]>>;

export function answersFrom(rows: { side: string; category: string; values: string[] }[]): Answers {
  const answers: Answers = { self: {}, seeking: {} };
  for (const row of rows) {
    if ((row.side === "self" || row.side === "seeking") && byKey.has(row.category)) answers[row.side][row.category] = row.values;
  }
  return answers;
}

/** Choix multiple pour ce côté (« Ce que je recherche » l'est toujours). */
export function isMultiple(side: Side, category: CatalogCategory): boolean {
  return side === "seeking" || category.multiple;
}

/**
 * Nouvelle sélection après un clic sur une étiquette :
 * - choix unique : l'étiquette remplace la précédente, un second clic la retire ;
 * - choix multiple : ajout ou retrait, sans dépasser le maximum (personnalité : 5) ;
 * - « Indifférent » (Ce que je recherche) exclut les autres choix, et inversement.
 */
export function toggleValue(side: Side, category: CatalogCategory, current: readonly string[], value: string): string[] {
  const selected = current.includes(value);
  if (!isMultiple(side, category)) return selected ? [] : [value];
  if (selected) return current.filter((v) => v !== value);
  if (value === INDIFFERENT) return [INDIFFERENT];
  const others = current.filter((v) => v !== INDIFFERENT);
  if (side === "self" && category.max !== undefined && others.length >= category.max) return others;
  return [...others, value];
}

/** Valeurs admises (contrôle côté serveur) : options du catalogue, plus « Indifférent » pour la recherche. */
export function checkAnswer(side: string, categoryKey: string, values: unknown): string[] | null {
  if (side !== "self" && side !== "seeking") return null;
  const category = byKey.get(categoryKey);
  if (!category || !Array.isArray(values) || !values.every((v) => typeof v === "string")) return null;
  const allowed = new Set<string>(category.options);
  if (side === "seeking") allowed.add(INDIFFERENT);
  const unique = [...new Set(values as string[])];
  if (!unique.every((v) => allowed.has(v))) return null;
  if (!isMultiple(side, category) && unique.length > 1) return null;
  if (side === "self" && category.max !== undefined && unique.length > category.max) return null;
  if (unique.includes(INDIFFERENT) && unique.length > 1) return null;
  return unique;
}

/** Catégorie remplie : au moins un choix (personnalité : au moins 3 pour « Je me décris »). */
export function isAnswered(side: Side, category: CatalogCategory, values: readonly string[] | undefined): boolean {
  const count = values?.length ?? 0;
  if (side === "self" && category.min !== undefined) return count >= category.min;
  return count > 0;
}

/** Progression d'un côté : catégories obligatoires remplies (et textes écrits pour « Je me décris »). */
export function progress(side: Side, answers: Answers, writtenTexts: number): { done: number; total: number } {
  const required = PROFILE_CATALOG.filter((c) => !c.optional);
  const done = required.filter((c) => isAnswered(side, c, answers[side][c.key])).length;
  return side === "self"
    ? { done: done + Math.min(writtenTexts, textFields.length), total: required.length + textFields.length }
    : { done, total: required.length };
}

/** Un critère non négociable porte sur une recherche précise (ni vide, ni « Indifférent »). */
export function canBeDealbreaker(values: readonly string[] | undefined): boolean {
  return Boolean(values?.length) && !values!.includes(INDIFFERENT);
}

export const maxDealbreakers = RULES.profile.maxDealbreakers;

export type TextResult = "saved" | "removed" | "too_long" | "text_rejected" | "failed";

/** Longueur maximale d'un texte libre (environ 300 caractères, section 8.1). */
export const textMaxLength = RULES.profile.freeTextMaxLength;
