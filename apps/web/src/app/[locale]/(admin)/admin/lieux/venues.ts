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
