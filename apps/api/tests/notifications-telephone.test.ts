import { describe, expect, it } from "vitest";
import { isGone, pushContent } from "../src/notifications/push.service";

/** Notifications sur le téléphone (décisions du 04/11/2026). */
describe("Notifications sur le téléphone", () => {
  it("texte discret dans la langue du membre, sans prénom ni détail", () => {
    expect(pushContent("fr")).toEqual({ title: "Ifedele", body: "Vous avez une nouvelle notification.", url: "/espace/notifications", tag: "ifedele" });
    expect(pushContent("en").body).toBe("You have a new notification.");
    expect(pushContent("en").url).toBe("/en/espace/notifications");
    expect(pushContent("yo").url).toBe("/yo/espace/notifications");
    // Langue inconnue : français
    expect(pushContent("de")).toEqual(pushContent("fr"));
  });

  it("appareil disparu seulement sur 404 et 410", () => {
    expect(isGone(404)).toBe(true);
    expect(isGone(410)).toBe(true);
    expect(isGone(429)).toBe(false);
    expect(isGone(500)).toBe(false);
    expect(isGone(undefined)).toBe(false);
  });
});
