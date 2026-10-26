import { describe, expect, it } from "vitest";
import {
  answerAccess,
  type CounselorAccess,
  counselorCanRead,
  counselorReadableSince,
  requestAccess,
  revokeAccess,
  showCounselorBanner,
} from "../src/counselor";
import { canOfferPhoneShare, phonesShared } from "../src/couple";

const couple = ["afiwa", "koffi"] as const;
const t0 = new Date("2026-11-01T10:00:00Z");
const t1 = new Date("2026-11-02T10:00:00Z");
const before = new Date("2026-10-30T10:00:00Z");

const requested = requestAccess(couple, "afiwa", true) as CounselorAccess;

describe("Accès du conseiller au chat du couple (9.6)", () => {
  it("demande par l'un des deux seulement ; sans accord, aucune lecture", () => {
    expect(requestAccess(couple, "sena", false)).toBe("not_member");
    expect(requested.status).toBe("requested");
    expect(counselorCanRead(requested, t1)).toBe(false);
    expect(showCounselorBanner(requested)).toBe(false);
  });

  it("l'accord de l'autre est obligatoire ; celui qui demande ne peut pas accepter à sa place", () => {
    expect(answerAccess(requested, "afiwa", true, true, t0)).toBe("own_request");
    expect(answerAccess(requested, "sena", true, true, t0)).toBe("not_member");
    const refused = answerAccess(requested, "koffi", false, false, t0) as CounselorAccess;
    expect(refused.status).toBe("refused");
    expect(counselorCanRead(refused, t1)).toBe(false);
    expect(answerAccess(refused, "koffi", true, false, t1)).toBe("not_pending");
  });

  it("à partir de l'acceptation ; l'historique seulement si les deux l'ont coché", () => {
    const noHistory = answerAccess(requested, "koffi", true, false, t0) as CounselorAccess;
    expect(counselorReadableSince(noHistory)).toEqual(t0);
    expect(counselorCanRead(noHistory, before)).toBe(false);
    expect(counselorCanRead(noHistory, t1)).toBe(true);
    expect(showCounselorBanner(noHistory)).toBe(true);
    const history = answerAccess(requested, "koffi", true, true, t0) as CounselorAccess;
    expect(counselorReadableSince(history)).toBe("all");
    expect(counselorCanRead(history, before)).toBe(true);
    const onlyOne = answerAccess(requestAccess(couple, "afiwa", false) as CounselorAccess, "koffi", true, true, t0) as CounselorAccess;
    expect(counselorCanRead(onlyOne, before)).toBe(false);
  });

  it("retrait par l'un ou l'autre, effet immédiat", () => {
    const granted = answerAccess(requested, "koffi", true, true, t0) as CounselorAccess;
    for (const member of couple) {
      const revoked = revokeAccess(granted, member) as CounselorAccess;
      expect(revoked.status).toBe("revoked");
      expect(counselorCanRead(revoked, t1)).toBe(false);
      expect(showCounselorBanner(revoked)).toBe(false);
    }
    expect(revokeAccess(granted, "sena")).toBe("not_member");
    expect(counselorCanRead(null, t1)).toBe(false);
  });
});

describe("Partage des numéros dans l'espace du couple (9.5, question 10 d)", () => {
  const member = (memberId: string, allowsSharing: boolean, clicked: boolean) => ({ memberId, allowsSharing, clicked });

  it("seulement quand les deux ont cliqué", () => {
    expect(phonesShared([member("afiwa", true, true), member("koffi", true, false)])).toBe(false);
    expect(phonesShared([member("afiwa", true, true), member("koffi", true, true)])).toBe(true);
  });

  it("sans autorisation, pas de bouton ni de partage", () => {
    expect(canOfferPhoneShare(member("afiwa", false, false))).toBe(false);
    expect(canOfferPhoneShare(member("afiwa", true, false))).toBe(true);
    expect(canOfferPhoneShare(member("afiwa", true, true))).toBe(false);
    expect(phonesShared([member("afiwa", false, true), member("koffi", true, true)])).toBe(false);
  });
});
