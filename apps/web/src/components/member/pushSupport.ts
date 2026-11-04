/** Notifications sur le téléphone (web push, 04/11/2026) : règles partagées, testées sans navigateur. */

export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string; userAgent?: string | null };

/** État du bouton « Activer les notifications » sur cet appareil. */
export type PushState = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

export function isPushSubscription(value: unknown): value is PushSubscriptionInput {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.endpoint === "string" &&
    v.endpoint.startsWith("https://") &&
    v.endpoint.length <= 1000 &&
    typeof v.p256dh === "string" &&
    v.p256dh.length > 0 &&
    v.p256dh.length <= 200 &&
    typeof v.auth === "string" &&
    v.auth.length > 0 &&
    v.auth.length <= 100 &&
    (v.userAgent === undefined || v.userAgent === null || typeof v.userAgent === "string")
  );
}

/** Clé publique VAPID (base64 URL) en octets, comme l'attend pushManager.subscribe. */
export function vapidKeyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Sans prise en charge : sur iPhone ou iPad hors écran d'accueil, on indique comment l'installer
 * (les notifications n'y fonctionnent que depuis l'écran d'accueil, iOS 16.4 et plus).
 */
export function unsupportedState(userAgent: string, standalone: boolean): PushState {
  const ios = /iPhone|iPad|iPod/.test(userAgent);
  return ios && !standalone ? "ios-install" : "unsupported";
}
