/** Ligne de app.verification_queue() : aucun chemin de fichier, seulement l'état du dossier. */
export type QueueRow = {
  verification_id: string;
  user_id: string;
  member_number: string | null;
  first_name: string | null;
  last_name: string | null;
  status: "pending" | "to_correct";
  submitted_at: string | null;
  document_kind: "id_card" | "driving_licence" | "passport" | null;
  has_selfie: boolean;
  declared_status: "single" | "divorced" | "widowed" | "other" | null;
  ready: boolean;
};

/** Filtres de la file, reflétés dans l'adresse (?etat=) comme le demande la section 11.3. */
export const queueFilters = [
  { key: "all", query: undefined },
  { key: "ready", query: "complets" },
  { key: "pending", query: "en-attente" },
  { key: "to_correct", query: "a-corriger" },
] as const;
export type QueueFilter = (typeof queueFilters)[number]["key"];

export function parseQueueFilter(value: string | string[] | undefined): QueueFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return queueFilters.find((f) => f.query !== undefined && f.query === raw)?.key ?? "all";
}

export function filterQueue(rows: QueueRow[], filter: QueueFilter): QueueRow[] {
  if (filter === "ready") return rows.filter((r) => r.ready && r.status === "pending");
  if (filter === "pending" || filter === "to_correct") return rows.filter((r) => r.status === filter);
  return rows;
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
