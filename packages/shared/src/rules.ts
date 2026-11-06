/**
 * Constantes des règles métier (section 9 de la note).
 * Toute valeur paramétrable par l'administration a ici sa valeur par défaut ;
 * la valeur effective sera lue dans la table settings.
 */
export const RULES = {
  evenings: {
    /** 30 participants : 15 femmes et 15 hommes (demande du 06/11/2026). */
    defaultCapacityPerSex: 15,
    maxCapacityPerSex: 15,
    /** Prix d'une place (06/11/2026). */
    defaultPriceXof: 20_000,
    maxPerWeek: 3,
    confirmationHoursBefore: 48,
    roundMinutes: 7,
    changeoverMinutes: 1,
  },
  votes: {
    /** Heure d'annonce des matchs le lendemain, heure de Cotonou. */
    matchAnnouncementHour: 8,
  },
  discovery: {
    durationDays: 14,
    extensionDays: 7,
    /** Prolongation demandable seulement pendant les derniers jours (question 3, 27 octobre 2026). */
    extensionRequestWindowDays: 4,
    maxExtensions: 1,
    /** 3 matchs au plus par soirée et par personne, ouverts aussitôt, sans choix (06/11/2026). */
    maxMatchesPerEvening: 3,
    pendingMatchExpiryDays: 7,
    closedMessage: "Cette mise en relation est terminée.",
  },
  couple: {
    inactivityAlertDays: 60,
    separationChatRetentionDays: 90,
    unionChatRetentionMonths: 12,
    returnToEveningsAfterSeparationMonths: 1,
  },
  profile: {
    freeTextMaxLength: 300,
    maxDealbreakers: 3,
    personalityMin: 3,
    personalityMax: 5,
  },
  safety: {
    signedPhotoUrlSeconds: 5 * 60,
    reportTargetHours: 24,
  },
  /** Phase 4 (propositions validées le 27 octobre 2026, PROPOSITIONS-QUESTIONS-PHASE4.txt). */
  memorySpace: {
    unionPhotosPerMember: 3,
  },
  cagnotte: {
    minContributionXof: 1000,
    maxDurationDays: 90,
    /** Commission Ifedele par défaut (réglable dans l'administration). */
    commissionPercent: 0,
    messageMaxLength: 300,
  },
  referral: {
    rewardXof: 2000,
    maxRewardedPerYear: 5,
  },
  badges: {
    eveningsAttendedMin: 2,
  },
  timeZone: "Africa/Porto-Novo",
} as const;

export const ROLES = ["member", "counselor", "moderator", "admin", "super_admin"] as const;
export type Role = (typeof ROLES)[number];
