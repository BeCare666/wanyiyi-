/** Sexe tel qu'enregistré dans le profil (quotas séparés, section 9.2). */
export type Sex = "female" | "male";

/** Situation du membre pour une soirée (app.my_bookings). */
export type MyBooking = {
  status: "booked" | "confirmed" | "checked_in" | "released" | "waitlisted";
  waitlist_rank: number | null;
  confirm_by: string;
  paid: boolean;
  /** Limite de paiement : sans paiement, la place est libérée (question 12, 24 h). */
  pay_by: string | null;
};

/** Réponse de GET /events. Le lieu n'est connu qu'une fois la place confirmée (RLS). */
export type Evening = {
  id: string;
  starts_at: string;
  status: "published" | "full";
  price_xof: number | null;
  capacity_women: number;
  capacity_men: number;
  round_minutes: number;
  theme: { key: string; min_age: number | null; max_age: number | null } | null;
  venue: { name: string; address: string; city: string } | null;
  seats: { sex: Sex; capacity: number; taken: number; waiting: number }[];
  mine: MyBooking | null;
};

export type EveningAction = "book" | "waitlist" | "confirm" | "pay" | "cancel";

export const eveningFilters = ["all", "mine", "available"] as const;
export type EveningFilter = (typeof eveningFilters)[number];

/** Filtre lu dans l'adresse (?filtre=), « toutes » par défaut. */
export function parseFilter(value: string | string[] | undefined): EveningFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return eveningFilters.find((f) => f === raw) ?? "all";
}

/** Places restantes pour un sexe (jamais négatif). */
export function freeSeats(evening: Evening, sex: Sex): number {
  const s = evening.seats.find((seat) => seat.sex === sex);
  return s ? Math.max(0, s.capacity - s.taken) : 0;
}

/** Le membre a une place ou est en liste d'attente (une place libérée ne compte plus). */
export function isRegistered(evening: Evening): boolean {
  return evening.mine !== null && evening.mine.status !== "released";
}

/**
 * Actions proposées au membre. Les règles elles-mêmes (validation, quotas, 48 h, thème)
 * restent appliquées par la base : ce calcul ne sert qu'à afficher les bons boutons.
 * Sans sexe connu (profil incomplet), aucune réservation n'est proposée.
 */
export function eveningActions(evening: Evening, sex: Sex | null, now: Date): EveningAction[] {
  const mine = evening.mine;
  if (!mine || mine.status === "released") {
    if (!sex) return [];
    return [freeSeats(evening, sex) > 0 ? "book" : "waitlist"];
  }
  const actions: EveningAction[] = [];
  if (mine.status === "booked" && now.getTime() < new Date(mine.confirm_by).getTime()) actions.push("confirm");
  if ((mine.status === "booked" || mine.status === "confirmed") && evening.price_xof !== null && !mine.paid) actions.push("pay");
  if (mine.status === "booked" || mine.status === "confirmed" || mine.status === "waitlisted") actions.push("cancel");
  return actions;
}

/** Filtre de la liste : toutes, mes soirées, ou celles où une place reste libre pour mon sexe. */
export function filterEvenings(evenings: Evening[], filter: EveningFilter, sex: Sex | null): Evening[] {
  if (filter === "mine") return evenings.filter(isRegistered);
  if (filter === "available") return evenings.filter((e) => sex !== null && freeSeats(e, sex) > 0);
  return evenings;
}

/** Mois (AAAA-MM) à l'heure de Cotonou. Créé une seule fois : la construction est coûteuse. */
const monthOf = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Porto-Novo", year: "numeric", month: "2-digit" });

/** Calendrier : soirées regroupées par mois (heure de Cotonou), dans l'ordre chronologique. */
export function groupByMonth(evenings: Evening[]): { month: string; evenings: Evening[] }[] {
  const groups = new Map<string, Evening[]>();
  for (const evening of [...evenings].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const month = monthOf.format(new Date(evening.starts_at)).slice(0, 7);
    groups.set(month, [...(groups.get(month) ?? []), evening]);
  }
  return [...groups].map(([month, list]) => ({ month, evenings: list }));
}

/** Codes d'erreur de l'API qui ont un texte dédié (sinon : message générique). */
export const knownEveningErrors = new Set([
  "not_validated",
  "couple_exclusivity",
  "blocked_until",
  "theme_age",
  "theme_religion",
  "theme_sector",
  "already_registered",
  "evening_closed",
  "confirmation_closed",
  "not_booked",
  "not_registered",
  "price_not_set",
  "unavailable",
]);
