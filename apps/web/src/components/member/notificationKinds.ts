import { coupleSpace, memberHome, memberNav } from "./memberNav";

/** Types de notification connus, avec la page où ils mènent (les autres : texte générique). */
const kinds = {
  evening_seat_offered: { href: { pathname: memberNav.evenings.href, query: { filtre: "mine" } } },
  match_announced: { href: { pathname: memberNav.matches.href } },
  // Soirée publiée modifiée ou annulée (19 octobre 2026)
  evening_updated: { href: { pathname: memberNav.evenings.href, query: { filtre: "mine" } } },
  evening_cancelled: { href: { pathname: memberNav.evenings.href, query: { filtre: "mine" } } },
  // Décisions de l'équipe (19 octobre 2026) : le motif est affiché avec la notification
  member_suspended: { href: null },
  member_reactivated: { href: null },
  member_excluded: { href: null },
  // Actions groupées de l'équipe (19 octobre 2026) : message en trois langues, invitation à une soirée
  team_message: { href: null },
  evening_invitation: { href: { pathname: memberNav.evenings.href } },
  // Texte de profil refusé par la modération (22 octobre 2026) : le motif est affiché
  profile_text_rejected: { href: null },
  // Photo refusée par la modération (phase 3, question 10) : le motif est affiché
  profile_photo_rejected: { href: null },
  // L'autre membre a demandé la suppression de son compte (24 octobre 2026) : découverte ou couple clôturé
  discovery_partner_left: { href: null },
  couple_partner_left: { href: null },
  // Découvertes (phase 3, 9.4) : ouverture, prolongation, fin (message neutre), match non ouvert, couple
  discovery_opened: { href: { pathname: memberNav.matches.href } },
  discovery_extended: { href: { pathname: memberNav.matches.href } },
  discovery_closed: { href: null },
  match_expired: { href: null },
  couple_opened: { href: { pathname: coupleSpace } },
  // Conseiller du couple et blocage (question 9, 26 octobre 2026) ; le motif d'un blocage est affiché
  counselor_access_requested: { href: { pathname: coupleSpace } },
  counselor_access_payment_due: { href: { pathname: coupleSpace } },
  counselor_assigned: { href: { pathname: coupleSpace } },
  counselor_access_granted: { href: null },
  couple_blocked: { href: { pathname: coupleSpace } },
  couple_unblocked: { href: { pathname: coupleSpace } },
  // Vie et fins du couple (questions 6 et 7, 26 octobre 2026)
  couple_inactive: { href: null },
  couple_paused: { href: { pathname: coupleSpace } },
  couple_union_celebrated: { href: { pathname: coupleSpace } },
  couple_separated: { href: null },
  couple_ended_by_partner: { href: null },
  couple_ended_by_partner_counselor: { href: null },
  // « Bien rentré(e) ? » (question 5, 27 octobre 2026) : réponse sur le tableau de bord ; alertes à l'équipe
  date_checkin: { href: { pathname: memberHome } },
  date_checkin_reminder: { href: { pathname: memberHome } },
  date_help_requested: { href: null },
  date_checkin_no_answer: { href: null },
  // Signalements (question 11) : nouveau signalement pour l'équipe ; avertissement avec son motif
  report_received: { href: null },
  member_warned: { href: null },
  // Séances avec le conseiller (question 9) : proposée aux membres, confirmée pour le conseiller
  session_proposed: { href: { pathname: coupleSpace } },
  session_confirmed: { href: null },
  // Photo de l'union refusée par la modération (espace souvenir, phase 4) : le motif est affiché
  couple_union_photo_rejected: { href: { pathname: coupleSpace } },
  // Cagnotte (phase 4, question 3) : proposition, réponse, demandes de l'autre, contribution, clôture, reversement
  cagnotte_proposed: { href: { pathname: coupleSpace } },
  cagnotte_refused: { href: { pathname: coupleSpace } },
  cagnotte_opened: { href: { pathname: coupleSpace } },
  cagnotte_close_requested: { href: { pathname: coupleSpace } },
  cagnotte_payout_requested: { href: { pathname: coupleSpace } },
  cagnotte_contribution: { href: { pathname: coupleSpace } },
  cagnotte_closed: { href: { pathname: coupleSpace } },
  cagnotte_paid_out: { href: { pathname: coupleSpace } },
  // Décision de l'équipe sur le dossier de vérification (30 octobre 2026) ; le motif est affiché
  verification_approved: { href: { pathname: memberNav.evenings.href } },
  verification_to_correct: { href: { pathname: memberNav.verification.href } },
  verification_rejected: { href: null },
  // Parrainage acquis (phase 4, question 4)
  referral_acquired: { href: { pathname: memberNav.referral.href } },
} as const;

export type NotificationKey = keyof typeof kinds | "other";

/** Clé de traduction (Member.bell.kinds) : les points du type deviennent des tirets bas. */
export function notificationKey(kind: string): NotificationKey {
  const key = kind.replace(/\./g, "_");
  return Object.hasOwn(kinds, key) ? (key as keyof typeof kinds) : "other";
}

/** Page à ouvrir depuis la notification, ou null si elle n'en a pas. */
export function notificationHref(kind: string) {
  const key = notificationKey(kind);
  return key === "other" ? null : kinds[key].href;
}

/**
 * Texte d'un message de l'équipe (action groupée, 19 octobre 2026) dans la langue affichée,
 * en français à défaut ; null pour les autres notifications.
 */
export function teamMessage(payload: unknown, locale: string): string | null {
  const body = (payload as { body?: Record<string, unknown> } | null)?.body;
  if (!body || typeof body !== "object") return null;
  const text = body[locale] ?? body.fr;
  return typeof text === "string" && text.trim() !== "" ? text : null;
}
