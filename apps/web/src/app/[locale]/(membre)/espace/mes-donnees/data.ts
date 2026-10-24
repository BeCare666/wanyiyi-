/**
 * Mes données (question 16, 24 octobre 2026) : contenu rendu par app.my_data(), téléchargé en JSON
 * ou lu sur une page imprimable (« Enregistrer en PDF » du navigateur).
 */

type Item = Record<string, unknown>;

export type MyData = {
  exported_at: string;
  account: Item | null;
  profile: Item | null;
  texts: Item[];
  answers: Item[];
  dealbreakers: string[];
  verification: Item[];
  honor_declarations: Item[];
  evenings: Item[];
  votes: Item[];
  matches: Item[];
  payments: Item[];
  notifications: Item[];
  notification_preferences: Item[];
  deletion: Item | null;
};

/** Rubriques de la page imprimable, dans l'ordre (clé de traduction Member.myData.sections). */
export const dataSections = [
  "account",
  "profile",
  "texts",
  "answers",
  "dealbreakers",
  "verification",
  "honor_declarations",
  "evenings",
  "votes",
  "matches",
  "payments",
  "notifications",
  "notification_preferences",
  "deletion",
] as const satisfies readonly (keyof MyData)[];

export type DataSection = (typeof dataSections)[number];

/** Lignes d'une rubrique : un objet seul devient une ligne, une liste de libellés une ligne chacun. */
export function sectionRows(data: MyData, section: DataSection): Item[] {
  const value = data[section];
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return [value];
  return value.map((v) => (typeof v === "object" && v !== null ? (v as Item) : { category: v }));
}

/** Champs datés : avec l'heure, sauf la date de naissance. */
const dateFields = new Set(["birth_date"]);
const dateTimeFields = new Set(["starts_at", "evening"]);

export type ValueKind = "date" | "dateTime" | "boolean" | "amount" | "text" | "empty";

/** Nature d'une valeur, pour la mise en forme dans la langue affichée. */
export function valueKind(key: string, value: unknown): ValueKind {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return "boolean";
  if (dateFields.has(key)) return "date";
  if (key.endsWith("_at") || key === "purge_after" || dateTimeFields.has(key)) return "dateTime";
  if (key.endsWith("_xof") && typeof value === "number") return "amount";
  return "text";
}

/** Valeur brute en texte : liste séparée par des virgules, objet (contenu d'une notification) en JSON. */
export function plainText(value: unknown): string {
  if (Array.isArray(value)) return value.map(plainText).join(", ");
  if (typeof value === "object" && value !== null) return Object.keys(value).length === 0 ? "" : JSON.stringify(value);
  return String(value);
}

/** Nom du fichier téléchargé, daté du jour de Cotonou. */
export function dataFileName(day: string): string {
  return `ifedele-mes-donnees-${day}.json`;
}
