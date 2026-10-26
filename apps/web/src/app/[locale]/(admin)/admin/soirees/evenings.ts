import type { ListNode } from "@/components/admin/listRules";

/** État d'une soirée (enum app.event_status). */
export type EventStatus = "draft" | "published" | "full" | "in_progress" | "finished" | "cancelled";

/** Ligne de app.admin_events() : remplissage par sexe, brouillons compris. */
export type AdminEventRow = {
  id: string;
  starts_at: string;
  status: EventStatus;
  venue_name: string | null;
  theme_key: string | null;
  price_xof: number | null;
  capacity_women: number;
  capacity_men: number;
  taken_women: number;
  taken_men: number;
  waiting_women: number;
  waiting_men: number;
  matches: number;
};

/** Ligne de app.event_participants() : inscription, ou rang dans la liste d'attente du même sexe. */
export type ParticipantRow = {
  user_id: string;
  member_number: string | null;
  first_name: string | null;
  last_name: string | null;
  sex: "female" | "male";
  status: "booked" | "confirmed" | "waitlisted" | "cancelled" | "released" | "checked_in" | "no_show";
  waitlist_position: number | null;
  registered_at: string;
  confirmed_at: string | null;
  checked_in_at: string | null;
  seat_number: number | null;
};

/** Filtres de la liste, reflétés dans l'adresse (?etat=, section 11.3). */
export const eventFilters = [
  { key: "all", query: undefined },
  { key: "upcoming", query: "a-venir" },
  { key: "drafts", query: "brouillons" },
  { key: "live", query: "en-cours" },
  { key: "past", query: "terminees" },
] as const;
export type EventFilter = (typeof eventFilters)[number]["key"];

export function parseEventFilter(value: string | string[] | undefined): EventFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return eventFilters.find((f) => f.query !== undefined && f.query === raw)?.key ?? "all";
}

const statusesOf: Record<Exclude<EventFilter, "all">, EventStatus[]> = {
  upcoming: ["published", "full"],
  drafts: ["draft"],
  live: ["in_progress"],
  past: ["finished", "cancelled"],
};

export function filterEvents<T extends { status: EventStatus }>(rows: T[], filter: EventFilter): T[] {
  return filter === "all" ? rows : rows.filter((r) => statusesOf[filter].includes(r.status));
}

/** Onglet de la liste en conditions du filtre avancé (app.admin_list), mêmes règles que filterEvents. */
export function eventConditions(filter: EventFilter): ListNode[] {
  return filter === "all" ? [] : [{ field: "status", cmp: "in", value: [...statusesOf[filter]] }];
}

/** Colonnes du fichier exporté de la liste des soirées (11.3). */
export const eventExportColumns = [
  "date",
  "status",
  "venue",
  "theme",
  "price",
  "capacity_women",
  "taken_women",
  "waiting_women",
  "capacity_men",
  "taken_men",
  "waiting_men",
  "matches",
] as const;
export type EventExportColumn = (typeof eventExportColumns)[number];

export function eventExportCell(
  row: AdminEventRow,
  column: EventExportColumn,
  labels: { status: (s: EventStatus) => string; date: (iso: string) => string },
): string | number | null {
  switch (column) {
    case "date":
      return labels.date(row.starts_at);
    case "status":
      return labels.status(row.status);
    case "venue":
      return row.venue_name;
    case "theme":
      return row.theme_key;
    case "price":
      return row.price_xof;
    case "capacity_women":
      return row.capacity_women;
    case "taken_women":
      return row.taken_women;
    case "waiting_women":
      return row.waiting_women;
    case "capacity_men":
      return row.capacity_men;
    case "taken_men":
      return row.taken_men;
    case "waiting_men":
      return row.waiting_men;
    case "matches":
      return row.matches;
  }
}

/**
 * Prochaine action du déroulé (9.2) : publier, préparer (tables, codes QR, rotation des
 * personnes pointées), commencer, terminer, calculer les matchs. Null : plus rien à faire.
 */
export type EveningStep = "publish" | "prepare" | "start" | "finish" | "compute";

export function nextStep(status: EventStatus, prepared: boolean, resultsComputed: boolean): EveningStep | null {
  if (status === "draft") return "publish";
  if (status === "published" || status === "full") return prepared ? "start" : "prepare";
  if (status === "in_progress") return "finish";
  if (status === "finished" && !resultsComputed) return "compute";
  return null;
}

/** Pointage possible : place confirmée, soirée publiée et pas encore préparée (la rotation fige la liste). */
export function canCheckIn(participant: Pick<ParticipantRow, "status">, status: EventStatus, prepared: boolean): boolean {
  return participant.status === "confirmed" && (status === "published" || status === "full") && !prepared;
}

/** Inscriptions actives d'un sexe (places occupées), puis liste d'attente, puis le reste. */
export function groupParticipants(rows: ParticipantRow[], sex: "female" | "male") {
  const ofSex = rows.filter((r) => r.sex === sex);
  return {
    seated: ofSex.filter((r) => r.status === "booked" || r.status === "confirmed" || r.status === "checked_in"),
    waiting: ofSex.filter((r) => r.status === "waitlisted"),
    other: ofSex.filter((r) => r.status === "cancelled" || r.status === "released" || r.status === "no_show"),
  };
}

const COTONOU = "Africa/Porto-Novo";
const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Valeur d'un champ « datetime-local » saisie à l'heure de Cotonou (UTC+1 toute l'année,
 * sans heure d'été), convertie en date absolue. Null si la saisie est invalide.
 */
export function fromCotonouInput(value: string): Date | null {
  const m = LOCAL_INPUT.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const date = new Date(Date.UTC(y, mo - 1, d, h - 1, mi));
  // Rejette les dates impossibles (31 février) : la date relue doit être la date saisie
  return toCotonouInput(date) === value.trim() ? date : null;
}

/** Date absolue vers la valeur d'un champ « datetime-local » à l'heure de Cotonou. */
export function toCotonouInput(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: COTONOU,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Brouillon saisi dans le formulaire, avant envoi à app.save_event. */
export type EventDraft = {
  venueId: string | null;
  themeId: string | null;
  startsAt: string;
  capacityWomen: number;
  capacityMen: number;
  roundMinutes: number;
  changeoverMinutes: number;
  priceXof: number | null;
};

/** Valeurs par défaut de la note (9.2) : 10 × 10, tours de 7 minutes, 1 minute de changement. */
export const draftDefaults = { capacityWomen: 10, capacityMen: 10, roundMinutes: 7, changeoverMinutes: 1 } as const;

/** Tarif proposé à la création d'une soirée : 10 000 FCFA, sans frais d'inscription (question 29, 22 octobre 2026). */
export const DEFAULT_PRICE_XOF = 10_000;

export type DraftError = "starts_at" | "starts_in_past" | "invalid_capacity" | "invalid_duration" | "invalid_price";

/** Contrôle côté site, identique à celui de app.save_event (la base reste juge). */
export function checkDraft(draft: EventDraft, now: Date): DraftError | null {
  const start = fromCotonouInput(draft.startsAt);
  if (!start) return "starts_at";
  if (start.getTime() <= now.getTime()) return "starts_in_past";
  const capacity = (n: number) => Number.isInteger(n) && n >= 1 && n <= 12;
  if (!capacity(draft.capacityWomen) || !capacity(draft.capacityMen)) return "invalid_capacity";
  if (!Number.isInteger(draft.roundMinutes) || draft.roundMinutes < 1) return "invalid_duration";
  if (!Number.isInteger(draft.changeoverMinutes) || draft.changeoverMinutes < 0) return "invalid_duration";
  if (draft.priceXof !== null && (!Number.isInteger(draft.priceXof) || draft.priceXof < 0)) return "invalid_price";
  return null;
}
