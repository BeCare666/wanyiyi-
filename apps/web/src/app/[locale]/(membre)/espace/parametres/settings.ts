import { routing } from "../../../../../i18n/routing";

/**
 * Canaux proposés au membre (section 6.2-9) : WhatsApp, dans l'application ; e-mail ajouté le 19 octobre 2026.
 * SMS retiré le 20 octobre 2026 (canal coupé, question 26).
 */
export const notificationChannels = ["in_app", "whatsapp", "email"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

export type Settings = {
  locale: (typeof routing.locales)[number];
  darkMode: boolean;
  channels: Record<NotificationChannel, boolean>;
};

export function isLocale(value: unknown): value is Settings["locale"] {
  return routing.locales.some((l) => l === value);
}

export function isChannel(value: unknown): value is NotificationChannel {
  return notificationChannels.some((c) => c === value);
}

/** Canaux du membre : un canal sans ligne en base est actif (valeur par défaut de la table). */
export function channelsFrom(rows: { channel: string; enabled: boolean }[]): Settings["channels"] {
  const channels = { in_app: true, whatsapp: true, email: true };
  for (const row of rows) if (isChannel(row.channel)) channels[row.channel] = row.enabled;
  return channels;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Adresse e-mail plausible (la confirmation par lien fait foi). */
export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

/**
 * Confidentialité (question 15, 24 octobre 2026) : photo cachée jusqu'à un match réciproque,
 * numéro partagé après un match. Par défaut : photo cachée, numéro partagé. Phase 3 (10.2) : garder
 * sa photo floutée même pendant la découverte, désactivé par défaut.
 */
export const privacyFields = ["photoHidden", "sharePhone", "keepBlurred"] as const;
export type PrivacyField = (typeof privacyFields)[number];
export type Privacy = Record<PrivacyField, boolean>;

/** Colonne de member_profiles de chaque réglage. */
export const privacyColumns = { photoHidden: "photo_blurred", sharePhone: "share_phone", keepBlurred: "keep_photo_blurred" } as const satisfies Record<PrivacyField, string>;

export function isPrivacyField(value: unknown): value is PrivacyField {
  return privacyFields.some((f) => f === value);
}

/** Réglages lus sur le profil ; sans profil, les valeurs par défaut de la base. */
export function privacyFrom(
  row: { photo_blurred?: boolean | null; share_phone?: boolean | null; keep_photo_blurred?: boolean | null } | null | undefined,
): Privacy {
  return { photoHidden: row?.photo_blurred ?? true, sharePhone: row?.share_phone ?? true, keepBlurred: row?.keep_photo_blurred ?? false };
}

/** Demande de suppression en cours (question 17) : effacement prévu le purgeAfter, annulable avant. */
export type Deletion = { requestedAt: string; purgeAfter: string } | null;

export type DeletionResult = "requested" | "cancelled" | "upcoming_evening" | "already_requested" | "no_request" | "failed";

const deletionErrors = ["upcoming_evening", "already_requested", "no_request"] as const;

/** Message d'erreur de la base vers un résultat connu du formulaire. */
export function deletionError(message: string | undefined): DeletionResult {
  return deletionErrors.find((e) => e === message) ?? "failed";
}
