import { encodeFilter, type FilterNode } from "../../app/[locale]/(admin)/admin/membres/filters";

/**
 * Filtres avancés des autres listes (section 11.3) : paiements, vérifications, soirées.
 * Mêmes règles que app.list_field, app.list_filter_sql et app.list_sort_sql
 * (migration 20261026000200) : l'interface n'envoie jamais un filtre refusé.
 * L'arbre ET / OU et son encodage dans l'adresse sont ceux de la liste des membres.
 */

export type ListName = "payments" | "verifications" | "events";
export type FieldKind = "text" | "list" | "number" | "date" | "boolean";
/** labels : préfixe des libellés des options dans l'espace de traduction « Admin ». */
export type FieldSpec = { kind: FieldKind; options?: readonly string[]; labels?: string };

export type ListSpec = {
  list: ListName;
  pathname: "/admin/paiements" | "/admin/verifications" | "/admin/soirees";
  /** Champs filtrables, dans l'ordre du sélecteur. */
  fields: Readonly<Record<string, FieldSpec>>;
  sortFields: readonly string[];
  columns: readonly string[];
  defaultColumns: readonly string[];
};

export type ListCondition =
  | { field: string; cmp: "contains"; value: string }
  | { field: string; cmp: "in"; value: string[] }
  | { field: string; cmp: "between"; value: [number | null, number | null] | [string | null, string | null] }
  | { field: string; cmp: "is"; value: boolean };

export const paymentsSpec: ListSpec = {
  list: "payments",
  pathname: "/admin/paiements",
  fields: {
    member: { kind: "text" },
    member_number: { kind: "text" },
    reference: { kind: "text" },
    status: { kind: "list", options: ["pending", "succeeded", "failed", "refunded", "cancelled"], labels: "payments.status" },
    purpose: { kind: "list", options: ["registration_fee", "evening_booking", "contribution"], labels: "payments.purposes" },
    provider: { kind: "list", options: ["simulated", "fedapay", "kkiapay", "feexpay"], labels: "payments.providers" },
    refund: { kind: "list", options: ["requested", "refunded", "none"], labels: "payments.refunds" },
    amount: { kind: "number" },
    refunded_amount: { kind: "number" },
    created_at: { kind: "date" },
    event_date: { kind: "date" },
    reconciled: { kind: "boolean" },
  },
  sortFields: ["created_at", "member", "amount", "status", "event_date"],
  columns: ["date", "purpose", "status", "provider", "amount"],
  defaultColumns: ["date", "purpose", "status", "provider", "amount"],
};

export const verificationsSpec: ListSpec = {
  list: "verifications",
  pathname: "/admin/verifications",
  fields: {
    member: { kind: "text" },
    member_number: { kind: "text" },
    status: { kind: "list", options: ["pending", "to_correct", "approved", "rejected"], labels: "verifications.status" },
    document_kind: { kind: "list", options: ["id_card", "passport", "driving_licence", "other"], labels: "verifications.kinds" },
    declared_status: { kind: "list", options: ["single", "divorced", "widowed", "other"], labels: "lists.declared" },
    sex: { kind: "list", options: ["female", "male"], labels: "verifications.identity.sexes" },
    age: { kind: "number" },
    submitted_at: { kind: "date" },
    created_at: { kind: "date" },
    ready: { kind: "boolean" },
    has_selfie: { kind: "boolean" },
  },
  sortFields: ["submitted_at", "created_at", "member", "status", "age"],
  columns: ["status", "dossier", "declared", "age", "submitted"],
  defaultColumns: ["status", "dossier", "submitted"],
};

export const eventsSpec: ListSpec = {
  list: "events",
  pathname: "/admin/soirees",
  fields: {
    venue: { kind: "text" },
    theme: { kind: "text" },
    status: { kind: "list", options: ["draft", "published", "full", "in_progress", "finished", "cancelled"], labels: "evenings.status" },
    starts_at: { kind: "date" },
    price: { kind: "number" },
    taken_women: { kind: "number" },
    taken_men: { kind: "number" },
    waiting: { kind: "number" },
    matches: { kind: "number" },
    has_venue: { kind: "boolean" },
  },
  sortFields: ["starts_at", "status", "price", "matches"],
  columns: ["status", "women", "men", "price", "matches"],
  defaultColumns: ["status", "women", "men", "matches"],
};

export const listSpecs: Record<ListName, ListSpec> = { payments: paymentsSpec, verifications: verificationsSpec, events: eventsSpec };

/** Limites de la base (3 niveaux, 20 conditions) et du constructeur (un niveau de sous-groupes, 14 conditions). */
const MAX_DEPTH = 3;
const MAX_CONDITIONS = 20;
export const BUILDER_MAX_CONDITIONS = 14;
const BUILDER_MAX_GROUP_DEPTH = 1;
/** Bornes des plages numériques : entiers de 9 chiffres au plus (montants en francs CFA compris). */
export const NUMBER_MAX = 999_999_999;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isGroup = (node: FilterNode | ListNode): node is ListGroup => "op" in node;

export type ListGroup = { op: "and" | "or"; items: ListNode[] };
export type ListNode = ListGroup | ListCondition;

export function emptyListCondition(spec: ListSpec, field: string): ListCondition {
  switch (spec.fields[field]?.kind) {
    case "text":
      return { field, cmp: "contains", value: "" };
    case "list":
      return { field, cmp: "in", value: [] };
    case "boolean":
      return { field, cmp: "is", value: true };
    default:
      return { field, cmp: "between", value: [null, null] };
  }
}

export function listConditionCount(node: ListNode): number {
  return isGroup(node) ? node.items.reduce((n, item) => n + listConditionCount(item), 0) : 1;
}

function listGroupDepth(node: ListNode): number {
  return isGroup(node) ? Math.max(0, ...node.items.filter(isGroup).map((g) => 1 + listGroupDepth(g))) : 0;
}

const isNumberBound = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= NUMBER_MAX);
const isDateBound = (v: unknown) => v === null || (typeof v === "string" && DATE.test(v));

/** Filtre conforme aux règles de la base pour cette liste. */
export function isValidListFilter(spec: ListSpec, node: unknown, depth = 0): node is ListNode {
  if (!node || typeof node !== "object") return false;
  const n = node as Record<string, unknown>;
  if ("op" in n) {
    if (depth >= MAX_DEPTH || (n.op !== "and" && n.op !== "or") || !Array.isArray(n.items)) return false;
    return n.items.every((item) => isValidListFilter(spec, item, depth + 1)) && (depth > 0 || listConditionCount(n as ListGroup) <= MAX_CONDITIONS);
  }
  const { field, cmp, value } = n;
  const kind = typeof field === "string" && Object.hasOwn(spec.fields, field) ? spec.fields[field]!.kind : null;
  switch (kind) {
    case "text":
      return cmp === "contains" && typeof value === "string" && value.length >= 1 && value.length <= 100;
    case "list": {
      const allowed = spec.fields[field as string]!.options ?? [];
      return cmp === "in" && Array.isArray(value) && value.length > 0 && value.every((v) => allowed.includes(v as string));
    }
    case "number":
    case "date": {
      const bound = kind === "number" ? isNumberBound : isDateBound;
      return cmp === "between" && Array.isArray(value) && value.length === 2 && value.every(bound) && value.some((v) => v !== null);
    }
    case "boolean":
      return cmp === "is" && typeof value === "boolean";
    default:
      return false;
  }
}

/** Filtre que le constructeur sait afficher et modifier. */
export function isBuilderListFilter(spec: ListSpec, node: unknown): node is ListGroup {
  return (
    isValidListFilter(spec, node) &&
    isGroup(node) &&
    listGroupDepth(node) <= BUILDER_MAX_GROUP_DEPTH &&
    listConditionCount(node) <= BUILDER_MAX_CONDITIONS
  );
}

/** Conditions incomplètes et groupes vides retirés ; null s'il ne reste rien. */
export function pruneListFilter(spec: ListSpec, node: ListNode, depth = 0): ListNode | null {
  if (isGroup(node)) {
    const items = node.items.map((item) => pruneListFilter(spec, item, depth + 1)).filter((item): item is ListNode => item !== null);
    return items.length === 0 ? null : { op: node.op, items };
  }
  return isValidListFilter(spec, node, depth) ? node : null;
}

export function encodeListFilter(node: ListNode): string {
  return encodeFilter(node as FilterNode);
}

/** Lecture de ?f= ; null si absent, illisible ou hors règles de la liste. */
export function decodeListFilter(spec: ListSpec, param: string | undefined): ListGroup | null {
  if (!param || param.length > 4000) return null;
  try {
    const base64 = param.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const node: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
    return isBuilderListFilter(spec, node) ? node : null;
  } catch {
    return null;
  }
}

export type ListSortKey = { field: string; dir: "asc" | "desc" };

/** Tri sur 3 colonnes au plus (?tri=amount.desc,created_at.asc). */
export function parseListSort(spec: ListSpec, param: string | undefined): ListSortKey[] {
  const out: ListSortKey[] = [];
  for (const part of (param ?? "").split(",")) {
    const [field, dir] = part.split(".");
    if (!spec.sortFields.includes(field ?? "") || (dir !== "asc" && dir !== "desc")) continue;
    if (out.some((s) => s.field === field) || out.length === 3) continue;
    out.push({ field: field!, dir });
  }
  return out;
}

export function formatListSort(sort: readonly ListSortKey[]): string {
  return sort.map((s) => `${s.field}.${s.dir}`).join(",");
}

/** Colonnes affichées (?colonnes=), dans l'ordre du tableau ; sans choix valable, colonnes par défaut. */
export function parseListColumns(spec: ListSpec, param: string | undefined): string[] {
  const chosen = new Set((param ?? "").split(","));
  const columns = spec.columns.filter((c) => chosen.has(c));
  return columns.length > 0 ? columns : [...spec.defaultColumns];
}

/**
 * Filtres rapides de la liste (déjà traduits en conditions) ajoutés au filtre avancé par un ET.
 * Un filtre avancé « ET » se fond dans la liste : un niveau de groupe en moins.
 */
export function combineListFilters(quick: readonly ListNode[], advanced: ListNode | null): ListNode | null {
  const items: ListNode[] = [...quick];
  if (advanced && isGroup(advanced) && advanced.op === "and") items.push(...advanced.items);
  else if (advanced) items.push(advanced);
  if (items.length === 0) return null;
  return items.length === 1 ? items[0]! : { op: "and", items };
}

/** Paramètres d'adresse des filtres avancés (sans page : on revient à la première). */
export function listFilterQuery(spec: ListSpec, quick: Record<string, string>, filter: ListNode | null, sort: readonly ListSortKey[], columns: readonly string[]) {
  const query: Record<string, string> = { ...quick };
  if (filter) query.f = encodeListFilter(filter);
  if (sort.length > 0) query.tri = formatListSort(sort);
  if (columns.join(",") !== spec.defaultColumns.join(",")) query.colonnes = columns.join(",");
  return query;
}

export type ListState = { filter: ListGroup | null; sort: ListSortKey[]; columns: string[] };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Filtres avancés, tri et colonnes lus dans l'adresse. */
export function parseListState(spec: ListSpec, params: Params): ListState {
  return {
    filter: decodeListFilter(spec, first(params.f)),
    sort: parseListSort(spec, first(params.tri)),
    columns: parseListColumns(spec, first(params.colonnes)),
  };
}

/** Page demandée (?page=), 1 par défaut. */
export function parseListPage(params: Params): number {
  const page = Number.parseInt(first(params.page) ?? "", 10);
  return Number.isInteger(page) && page > 1 ? page : 1;
}
