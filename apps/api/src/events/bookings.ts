/** Ligne de app.my_bookings() : situation du membre pour une soirée à venir. */
export type MyBooking = {
  event_id: string;
  status: "booked" | "confirmed" | "checked_in" | "released" | "waitlisted";
  waitlist_rank: number | null;
  confirm_by: string;
  paid: boolean;
};

/** Ajoute à chaque soirée la situation du membre (« mine »), ou null s'il n'y est pas inscrit. */
export function withMyBooking<E extends { id: string }>(events: E[], bookings: MyBooking[]) {
  const byEvent = new Map(bookings.map(({ event_id, ...booking }) => [event_id, booking]));
  return events.map((event) => ({ ...event, mine: byEvent.get(event.id) ?? null }));
}
