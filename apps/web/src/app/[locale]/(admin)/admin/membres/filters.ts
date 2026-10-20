import { memberStatuses, roles, sexes } from "./members";

/**
 * Filtres avancés de la liste des membres (section 11.3), mêmes règles que
 * app.member_filter_sql (migration 20261019000500) : l'interface n'envoie jamais un filtre refusé.
 */

export type FilterCondition =
  | { field: TextField; cmp: "contains"; value: string }
  | { field: ListField; cmp: "in"; value: string[] }
  | { field: NumberField; cmp: "between"; value: [number | null, number | null] }
  | { field: "created_at"; cmp: "between"; value: [string | null, string | null] }
  | { field: BooleanField; cmp: "is"; value: boolean };
export type FilterGroup = { op: "and" | "or"; items: FilterNode[] };
export type FilterNode = FilterGroup | FilterCondition;

export const textFields = ["name", "member_number", "phone", "city"] as const;
export const listFields = ["status", "role", "sex"] as const;
export const numberFields = ["age", "evenings_attended", "matches"] as const;
export const booleanFields = ["evenings_blocked", "sanctioned"] as const;
type TextField = (typeof textFields)[number];
type ListField = (typeof listFields)[number];
type NumberField = (typeof numberFields)[number];
type BooleanField = (typeof booleanFields)[number];
export type FilterField = TextField | ListField | NumberField | BooleanField | "created_at";
export const filterFields: readonly FilterField[] = [...textFields, ...listFields, ...numberFields, "created_at", ...booleanFields];

/** Valeurs permises des champs à choix multiples. */
export const listOptions: Record<ListField, readonly string[]> = { status: memberStatuses, role: roles, sex: sexes };

export const MAX_DEPTH = 3;
export const MAX_CONDITIONS = 20;

/**
 * Limites du constructeur : un niveau de sous-groupes et 14 conditions, pour rester dans celles
 * de la base une fois ajoutés la recherche simple et les filtres rapides (combineFilters).
 */
export const BUILDER_MAX_GROUP_DEPTH = 1;
export const BUILDER_MAX_CONDITIONS = 14;

const isGroup = (node: FilterNode): node is FilterGroup => "op" in node;

/** Condition vide (à compléter) pour un champ. */
export function emptyCondition(field: FilterField): FilterCondition {
  if ((textFields as readonly string[]).includes(field)) return { field: field as TextField, cmp: "contains", value: "" };
  if ((listFields as readonly string[]).includes(field)) return { field: field as ListField, cmp: "in", value: [] };
  if ((numberFields as readonly string[]).includes(field)) return { field: field as NumberField, cmp: "between", value: [null, null] };
  if (field === "created_at") return { field, cmp: "between", value: [null, null] };
  return { field: field as BooleanField, cmp: "is", value: true };
}

export function conditionCount(node: FilterNode): number {
  return isGroup(node) ? node.items.reduce((n, item) => n + conditionCount(item), 0) : 1;
}

/** Niveaux de sous-groupes sous la racine (0 : une seule liste de conditions). */
export function groupDepth(node: FilterNode): number {
  return isGroup(node) ? Math.max(0, ...node.items.filter(isGroup).map((g) => 1 + groupDepth(g))) : 0;
}

/** Filtre que le constructeur sait afficher et modifier : règles de la base et limites du constructeur. */
export function isBuilderFilter(node: unknown): node is FilterGroup {
  return (
    isValidFilter(node) &&
    isGroup(node) &&
    groupDepth(node) <= BUILDER_MAX_GROUP_DEPTH &&
    conditionCount(node) <= BUILDER_MAX_CONDITIONS
  );
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isBound = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9999);

/** Filtre conforme aux règles de la base (champs, comparaisons, valeurs, profondeur, nombre). */
export function isValidFilter(node: unknown, depth = 0): node is FilterNode {
  if (!node || typeof node !== "object") return false;
  const n = node as Record<string, unknown>;
  if ("op" in n) {
    if (depth >= MAX_DEPTH || (n.op !== "and" && n.op !== "or") || !Array.isArray(n.items)) return false;
    return n.items.every((item) => isValidFilter(item, depth + 1)) && (depth > 0 || conditionCount(n as FilterGroup) <= MAX_CONDITIONS);
  }
  const { field, cmp, value } = n;
  if ((textFields as readonly unknown[]).includes(field)) {
    return cmp === "contains" && typeof value === "string" && value.length >= 1 && value.length <= 100;
  }
  if ((listFields as readonly unknown[]).includes(field)) {
    const allowed = listOptions[field as ListField];
    return cmp === "in" && Array.isArray(value) && value.length > 0 && value.every((v) => allowed.includes(v as string));
  }
  if ((numberFields as readonly unknown[]).includes(field)) {
    return cmp === "between" && Array.isArray(value) && value.length === 2 && value.every(isBound) && value.some((v) => v !== null);
  }
  if (field === "created_at") {
    return (
      cmp === "between" &&
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((v) => v === null || (typeof v === "string" && DATE.test(v))) &&
      value.some((v) => v !== null)
    );
  }
  if ((booleanFields as readonly unknown[]).includes(field)) return cmp === "is" && typeof value === "boolean";
  return false;
}

/**
 * Filtre prêt à envoyer : conditions incomplètes et groupes vides retirés (l'interface garde
 * les lignes en cours de saisie), null s'il ne reste rien.
 */
export function pruneFilter(node: FilterNode, depth = 0): FilterNode | null {
  if (isGroup(node)) {
    const items = node.items.map((item) => pruneFilter(item, depth + 1)).filter((item): item is FilterNode => item !== null);
    return items.length === 0 ? null : { op: node.op, items };
  }
  return isValidFilter(node, depth) ? node : null;
}

/** Encodage dans l'adresse (?f=) : JSON en base64url, lisible par toute l'équipe qui reçoit le lien. */
export function encodeFilter(node: FilterNode): string {
  const bytes = new TextEncoder().encode(JSON.stringify(node));
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Lecture de ?f= (groupe racine du constructeur) ; null si absent, illisible ou hors règles. */
export function decodeFilter(param: string | undefined): FilterGroup | null {
  if (!param || param.length > 4000) return null;
  try {
    const base64 = param.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const node: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
    return isBuilderFilter(node) ? node : null;
  } catch {
    return null;
  }
}

/** Tri multi-colonnes (3 au plus), dans l'adresse : ?tri=age.desc,name.asc */
export const sortFields = ["created_at", "name", "age", "evenings_attended", "matches", "member_number", "status"] as const;
export type SortField = (typeof sortFields)[number];
export type SortKey = { field: SortField; dir: "asc" | "desc" };

export function parseSort(param: string | undefined): SortKey[] {
  const out: SortKey[] = [];
  for (const part of (param ?? "").split(",")) {
    const [field, dir] = part.split(".");
    if (!(sortFields as readonly string[]).includes(field ?? "") || (dir !== "asc" && dir !== "desc")) continue;
    if (out.some((s) => s.field === field) || out.length === 3) continue;
    out.push({ field: field as SortField, dir });
  }
  return out;
}

export function formatSort(sort: readonly SortKey[]): string {
  return sort.map((s) => `${s.field}.${s.dir}`).join(",");
}

/** Colonnes affichées (?colonnes=), dans l'ordre du tableau ; sans choix valable, colonnes par défaut. */
export const memberColumns = ["status", "role", "sex", "age", "city", "phone", "activity", "joined"] as const;
export type MemberColumn = (typeof memberColumns)[number];
export const defaultColumns: readonly MemberColumn[] = ["status", "role", "activity", "joined"];

export function parseColumns(param: string | undefined): MemberColumn[] {
  const chosen = new Set((param ?? "").split(","));
  const columns = memberColumns.filter((c) => chosen.has(c));
  return columns.length > 0 ? columns : [...defaultColumns];
}

/** Jour de Cotonou (UTC+1, sans heure d'été) au format AAAA-MM-JJ. */
export function cotonouDay(date: Date): string {
  return new Date(date.getTime() + 3600_000).toISOString().slice(0, 10);
}

/** Raccourcis de dates (11.3) : aujourd'hui, 7 derniers jours, ce mois, à l'heure de Cotonou. */
export const dateShortcuts = ["today", "week", "month"] as const;
export type DateShortcut = (typeof dateShortcuts)[number];

export function dateRange(shortcut: DateShortcut, now: Date): [string, string] {
  const today = cotonouDay(now);
  if (shortcut === "today") return [today, today];
  if (shortcut === "week") return [cotonouDay(new Date(now.getTime() - 6 * 86_400_000)), today];
  return [`${today.slice(0, 8)}01`, today];
}

/**
 * Recherche simple et filtres rapides de la liste, ajoutés au filtre avancé par un ET :
 * le texte cherche dans le nom, le numéro de membre ou le téléphone. Le tout reste dans
 * les limites de la base si le filtre avancé respecte celles du constructeur.
 */
export function combineFilters(
  quick: { search: string; status: string | null; role: string | null; sex: string | null },
  advanced: FilterNode | null,
): FilterNode | null {
  const items: FilterNode[] = [];
  if (quick.search) {
    const digits = quick.search.replace(/\D/g, "");
    const any: FilterCondition[] = [
      { field: "name", cmp: "contains", value: quick.search },
      { field: "member_number", cmp: "contains", value: quick.search },
    ];
    // Téléphone : chiffres seulement, à partir de 4 (comme la recherche globale)
    if (digits.length >= 4) any.push({ field: "phone", cmp: "contains", value: digits });
    items.push({ op: "or", items: any });
  }
  if (quick.status) items.push({ field: "status", cmp: "in", value: [quick.status] });
  if (quick.role) items.push({ field: "role", cmp: "in", value: [quick.role] });
  if (quick.sex) items.push({ field: "sex", cmp: "in", value: [quick.sex] });
  // Un filtre avancé « ET » se fond dans la liste : un niveau de groupe en moins
  if (advanced && "op" in advanced && advanced.op === "and") items.push(...advanced.items);
  else if (advanced) items.push(advanced);
  if (items.length === 0) return null;
  return items.length === 1 ? items[0]! : { op: "and", items };
}

/** Paramètres d'adresse d'un état de la liste (sans page : on revient à la première). */
export function listQuery(quick: Record<string, string>, filter: FilterNode | null, sort: readonly SortKey[], columns: readonly MemberColumn[]) {
  const query: Record<string, string> = { ...quick };
  if (filter) query.f = encodeFilter(filter);
  if (sort.length > 0) query.tri = formatSort(sort);
  if (columns.join(",") !== defaultColumns.join(",")) query.colonnes = columns.join(",");
  return query;
}
