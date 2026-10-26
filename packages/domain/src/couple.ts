/**
 * Espace du couple (section 9.5), règles déjà décidées :
 *   - partage des numéros seulement quand les deux ont cliqué « Partager mon numéro » ;
 *     un membre qui n'autorise pas le partage (réglage, question 10 d de la phase 3) n'a pas
 *     le bouton ;
 *   - exclusivité : la réservation des soirées est refusée (booking.ts, « couple_exclusivity »).
 * Inactivité et fins du couple : questions 6 et 7 de la phase 3, en attente.
 */

export type PhoneShareMember = { memberId: string; allowsSharing: boolean; clicked: boolean };

/** Bouton « Partager mon numéro » proposé à ce membre. */
export function canOfferPhoneShare(member: PhoneShareMember): boolean {
  return member.allowsSharing && !member.clicked;
}

/** Numéros visibles l'un de l'autre seulement quand les deux ont cliqué (et l'autorisent). */
export function phonesShared(members: readonly [PhoneShareMember, PhoneShareMember]): boolean {
  return members.every((m) => m.allowsSharing && m.clicked);
}
