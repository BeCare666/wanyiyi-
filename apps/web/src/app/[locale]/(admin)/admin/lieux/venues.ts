export type VenueInput = { name: string; address: string; city: string; isPartner: boolean };
export type VenueRow = { id: string; name: string; address: string; city: string; is_partner: boolean };

/** Contrôle de la saisie : nom, adresse et ville obligatoires, longueurs raisonnables. */
export function checkVenue(input: VenueInput): "name" | "address" | "city" | null {
  if (input.name.trim() === "" || input.name.length > 120) return "name";
  if (input.address.trim() === "" || input.address.length > 300) return "address";
  if (input.city.trim() === "" || input.city.length > 80) return "city";
  return null;
}

/** Colonnes du fichier exporté de la liste des lieux (11.3). */
export const venueExportColumns = ["name", "address", "city", "is_partner", "events", "created_at"] as const;
export type VenueExportColumn = (typeof venueExportColumns)[number];
export type VenueListRow = VenueRow & { events: number; created_at: string; total: number };

export function venueExportCell(
  row: VenueListRow,
  column: VenueExportColumn,
  labels: { yesNo: (b: boolean) => string; date: (iso: string) => string },
): string | number | null {
  switch (column) {
    case "name":
      return row.name;
    case "address":
      return row.address;
    case "city":
      return row.city;
    case "is_partner":
      return labels.yesNo(row.is_partner);
    case "events":
      return row.events;
    case "created_at":
      return labels.date(row.created_at);
  }
}

/** Lieu conseillé pour un premier rendez-vous (question 4, 27 octobre 2026). */
export const venueKinds = ["cafe", "restaurant", "other"] as const;
export type VenueKind = (typeof venueKinds)[number];
export type FirstDateInput = { partner: boolean; district: string; kind: VenueKind | ""; hours: string };
export type FirstDateRow = {
  id: string;
  name: string;
  city: string;
  first_date_partner: boolean;
  district: string | null;
  venue_kind: VenueKind | null;
  opening_hours: string | null;
};

/** Contrôle : quartier 80 caractères, horaires 120 ; un lieu conseillé a un quartier et un type. */
export function checkFirstDate(input: FirstDateInput): "district" | "kind" | "hours" | null {
  if (input.district.length > 80 || (input.partner && input.district.trim() === "")) return "district";
  if ((input.kind !== "" && !venueKinds.includes(input.kind)) || (input.partner && input.kind === "")) return "kind";
  if (input.hours.length > 120) return "hours";
  return null;
}
