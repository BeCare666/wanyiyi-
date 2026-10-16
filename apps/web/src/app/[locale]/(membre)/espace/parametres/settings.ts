import { routing } from "../../../../../i18n/routing";

/** Canaux proposés au membre (section 6.2-9) : WhatsApp, SMS, dans l'application. */
export const notificationChannels = ["in_app", "whatsapp", "sms"] as const;
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
  const channels = { in_app: true, whatsapp: true, sms: true };
  for (const row of rows) if (isChannel(row.channel)) channels[row.channel] = row.enabled;
  return channels;
}
