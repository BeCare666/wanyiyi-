import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPushSubscription, unsupportedState, vapidKeyBytes } from "../src/components/member/pushSupport";

/** Notifications sur le téléphone (décisions du 04/11/2026). */
describe("Notifications sur le téléphone", () => {
  it("abonnement accepté seulement s'il est complet et en https", () => {
    const ok = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "cle", auth: "secret" };
    expect(isPushSubscription(ok)).toBe(true);
    expect(isPushSubscription({ ...ok, userAgent: "Android" })).toBe(true);
    expect(isPushSubscription({ ...ok, endpoint: "http://exemple.com" })).toBe(false);
    expect(isPushSubscription({ ...ok, auth: "" })).toBe(false);
    expect(isPushSubscription({ ...ok, p256dh: "x".repeat(201) })).toBe(false);
    expect(isPushSubscription(null)).toBe(false);
  });

  it("clé publique VAPID décodée en octets (base64 URL sans remplissage)", () => {
    expect(Array.from(vapidKeyBytes("AQID_-8"))).toEqual([1, 2, 3, 255, 239]);
  });

  it("iPhone hors écran d'accueil : on explique comment l'installer", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
    expect(unsupportedState(iphone, false)).toBe("ios-install");
    expect(unsupportedState(iphone, true)).toBe("unsupported");
    expect(unsupportedState("Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0", false)).toBe("unsupported");
  });

  it("le service worker n'affiche que le texte reçu et n'ouvre que des pages du site", () => {
    const sw = readFileSync(join(__dirname, "../public/sw.js"), "utf8");
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(sw).toContain("target.origin === self.location.origin");
  });
});
