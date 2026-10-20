import { routing } from "../../../../../i18n/routing";

/** Canaux proposés au membre (section 6.2-9) : WhatsApp, SMS, dans l'application ; e-mail ajouté le 19 octobre 2026. */
export const notificationChannels = ["in_app", "whatsapp", "sms", "email"] as const;
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
  const channels = { in_app: true, whatsapp: true, sms: true, email: true };
  for (const row of rows) if (isChannel(row.channel)) channels[row.channel] = row.enabled;
  return channels;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Adresse e-mail plausible (la confirmation par lien fait foi). */
export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}
