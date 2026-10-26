import type { ListNode } from "@/components/admin/listRules";

/**
 * Ligne de app.verification_queue() : aucun chemin de fichier, seulement l'état du dossier.
 * La liste filtrée (app.admin_list) montre aussi les dossiers traités.
 */
export type QueueRow = {
  verification_id: string;
  user_id: string;
  member_number: string | null;
  first_name: string | null;
  last_name: string | null;
  status: "pending" | "to_correct" | "approved" | "rejected";
  submitted_at: string | null;
  document_kind: "id_card" | "driving_licence" | "passport" | null;
  has_selfie: boolean;
  declared_status: "single" | "divorced" | "widowed" | "other" | null;
  ready: boolean;
};

/** Ligne de app.admin_list('verifications') : celle de la file, plus sexe, âge et décision. */
export type VerificationListRow = QueueRow & {
  created_at: string;
  sex: "female" | "male" | null;
  age: number | null;
  decided_at: string | null;
  total: number;
};

/**
 * Filtres de la file, reflétés dans l'adresse (?etat=) comme le demande la section 11.3.
 * « Tous » : la file (en attente et à corriger) ; « Traités » : validés ou refusés.
 */
export const queueFilters = [
  { key: "all", query: undefined },
  { key: "ready", query: "complets" },
  { key: "pending", query: "en-attente" },
  { key: "to_correct", query: "a-corriger" },
  { key: "processed", query: "traites" },
] as const;
export type QueueFilter = (typeof queueFilters)[number]["key"];

export function parseQueueFilter(value: string | string[] | undefined): QueueFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return queueFilters.find((f) => f.query !== undefined && f.query === raw)?.key ?? "all";
}

export function filterQueue(rows: QueueRow[], filter: QueueFilter): QueueRow[] {
  if (filter === "ready") return rows.filter((r) => r.ready && r.status === "pending");
  if (filter === "pending" || filter === "to_correct") return rows.filter((r) => r.status === filter);
  if (filter === "processed") return rows.filter((r) => r.status === "approved" || r.status === "rejected");
  return rows.filter((r) => r.status === "pending" || r.status === "to_correct");
}

/** Onglet de la file en conditions du filtre avancé (app.admin_list), mêmes règles que filterQueue. */
export function queueConditions(filter: QueueFilter): ListNode[] {
  if (filter === "ready") {
    return [
      { field: "status", cmp: "in", value: ["pending"] },
      { field: "ready", cmp: "is", value: true },
    ];
  }
  if (filter === "pending" || filter === "to_correct") return [{ field: "status", cmp: "in", value: [filter] }];
  if (filter === "processed") return [{ field: "status", cmp: "in", value: ["approved", "rejected"] }];
  return [{ field: "status", cmp: "in", value: ["pending", "to_correct"] }];
}

/** Colonnes du fichier exporté (11.3) : identité et état du dossier, jamais un chemin de fichier. */
export const verificationExportColumns = [
  "member_number",
  "first_name",
  "last_name",
  "sex",
  "age",
  "status",
  "ready",
  "document_kind",
  "has_selfie",
  "declared_status",
  "submitted",
  "decided",
] as const;
export type VerificationExportColumn = (typeof verificationExportColumns)[number];

export type VerificationExportLabels = {
  status: (s: string) => string;
  sex: (s: string) => string;
  kind: (k: string) => string;
  declared: (d: string) => string;
  yesNo: (b: boolean) => string;
  date: (iso: string) => string;
};

export function verificationExportCell(row: VerificationListRow, column: VerificationExportColumn, labels: VerificationExportLabels): string | number | null {
  switch (column) {
    case "member_number":
      return row.member_number;
    case "first_name":
      return row.first_name;
    case "last_name":
      return row.last_name;
    case "sex":
      return row.sex ? labels.sex(row.sex) : null;
    case "age":
      return row.age;
    case "status":
      return labels.status(row.status);
    case "ready":
      return labels.yesNo(row.ready);
    case "document_kind":
      return row.document_kind ? labels.kind(row.document_kind) : null;
    case "has_selfie":
      return labels.yesNo(row.has_selfie);
    case "declared_status":
      return row.declared_status ? labels.declared(row.declared_status) : null;
    case "submitted":
      return row.submitted_at ? labels.date(row.submitted_at) : null;
    case "decided":
      return row.decided_at ? labels.date(row.decided_at) : null;
  }
}

/** Nom affiché dans l'administration (le nom de famille n'est jamais montré aux autres membres). */
export function memberName(row: { first_name: string | null; last_name: string | null }): string | null {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return name === "" ? null : name;
}

/** Âge révolu à une date donnée, à l'heure de Cotonou. */
export function ageOn(birthDate: string, on: Date): number {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Porto-Novo", year: "numeric", month: "2-digit", day: "2-digit" }).format(on);
  const [y, m, d] = today.split("-").map(Number);
  const [by, bm, bd] = birthDate.slice(0, 10).split("-").map(Number);
  return y! - by! - (m! < bm! || (m === bm && d! < bd!) ? 1 : 0);
}
