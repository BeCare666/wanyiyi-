import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import yo from "../messages/yo.json";
import { counselNotice } from "../src/app/[locale]/(membre)/espace/conseiller/counsel";
import { memberNav, memberSecondary } from "../src/components/member/memberNav";
import { notificationHref, notificationKey } from "../src/components/member/notificationKinds";

/** Conseiller sollicité seul et réservation sans profil complet (demande du 10 novembre 2026). */

describe("Conseiller sollicité seul", () => {
  it("rappel au-dessus de la discussion : gratuits restants, puis prix ; rien si tout est gratuit", () => {
    expect(counselNotice(200, 3)).toBe("free");
    expect(counselNotice(200, 0)).toBe("paid");
    expect(counselNotice(0, 0)).toBeNull();
  });

  it("entrée « Conseiller » dans le menu du membre", () => {
    expect(memberNav.counsel.href).toBe("/espace/conseiller");
    expect(memberSecondary).toContain(memberNav.counsel);
  });

  it("notifications : attribution vers la page du conseiller, autres sans lien", () => {
    expect(notificationKey("counsel.assigned")).toBe("counsel_assigned");
    expect(notificationHref("counsel.assigned")).toEqual({ pathname: "/espace/conseiller" });
    expect(notificationHref("counsel.closed")).toBeNull();
  });

  it("textes présents dans les trois langues, avec le prix et le nombre de messages gratuits", () => {
    for (const m of [fr, en, yo]) {
      expect(m.Member.counsel.pricing).toContain("{free}");
      expect(m.Member.counsel.pricing).toContain("{price}");
      expect(m.Member.counsel.freeLeft).toContain("{count, plural");
      expect(m.Member.bell.kinds.counsel_assigned).toBeTruthy();
      expect(m.Payment.purposes.counsel_message).toBeTruthy();
      expect(m.Admin.counselors.solo.pricing.errors.invalid_free_messages).toBeTruthy();
      expect(m.Member.nextStep.steps.bookCompleteProfile.also).toBeTruthy();
      expect("completeProfile" in m.Member.nextStep.steps).toBe(false);
    }
    expect(fr.Member.nextStep.steps.bookCompleteProfile.text).toContain("Pour plus de chances");
  });
});
