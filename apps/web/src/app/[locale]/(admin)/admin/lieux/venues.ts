export type VenueInput = { name: string; address: string; city: string; isPartner: boolean };
export type VenueRow = { id: string; name: string; address: string; city: string; is_partner: boolean };

/** Contrôle de la saisie : nom, adresse et ville obligatoires, longueurs raisonnables. */
export function checkVenue(input: VenueInput): "name" | "address" | "city" | null {
  if (input.name.trim() === "" || input.name.length > 120) return "name";
  if (input.address.trim() === "" || input.address.length > 300) return "address";
  if (input.city.trim() === "" || input.city.length > 80) return "city";
  return null;
}
