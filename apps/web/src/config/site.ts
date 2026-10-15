/**
 * Coordonnées publiques de la maison.
 * Valeur null : information non encore fournie, affichée « À compléter ».
 */
export const siteContact = {
  phone: null as string | null,
  email: null as string | null,
  whatsapp: null as string | null,
};

/** Ancres des sections de la page vitrine, dans l'ordre de la page. */
export const sectionIds = {
  promise: "promesse",
  journey: "parcours",
  evenings: "soirees",
  safety: "securite",
  support: "accompagnement",
  celebration: "celebration",
  upcoming: "prochaines-soirees",
  faq: "questions",
} as const;

/**
 * Réseaux sociaux de la maison, dans l'ordre d'affichage.
 * Adresse null : compte non encore communiqué, l'icône reste visible sans lien.
 */
export const siteSocial = [
  { network: "instagram", label: "Instagram", url: null as string | null },
  { network: "facebook", label: "Facebook", url: null as string | null },
  { network: "tiktok", label: "TikTok", url: null as string | null },
  { network: "linkedin", label: "LinkedIn", url: null as string | null },
  { network: "whatsapp", label: "WhatsApp", url: null as string | null },
] as const;
