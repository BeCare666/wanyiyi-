import { describe, expect, it } from "vitest";
import {
  answerAccess,
  assignCounselor,
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
/** Accord de l'autre puis attribution par l'administration. */
const grantedWith = (history: boolean, requesterHistory = true) =>
  assignCounselor(
    answerAccess(requestAccess(couple, "afiwa", requesterHistory) as CounselorAccess, "koffi", true, history, t0) as CounselorAccess,
    "conseillere",
    t0,
  ) as CounselorAccess;

describe("Conseiller du couple (9.6, question 9)", () => {
  it("invitation par l'un des deux seulement ; sans accord, aucune lecture", () => {
    expect(requestAccess(couple, "sena", false)).toBe("not_member");
    expect(requested.status).toBe("requested");
    expect(counselorCanRead(requested, t1)).toBe(false);
    expect(showCounselorBanner(requested)).toBe(false);
  });

  it("l'accord de l'autre est obligatoire ; celui qui invite ne peut pas accepter à sa place", () => {
    expect(answerAccess(requested, "afiwa", true, true, t0)).toBe("own_request");
    expect(answerAccess(requested, "sena", true, true, t0)).toBe("not_member");
    const refused = answerAccess(requested, "koffi", false, false, t0) as CounselorAccess;
    expect(refused.status).toBe("refused");
    expect(counselorCanRead(refused, t1)).toBe(false);
    expect(answerAccess(refused, "koffi", true, false, t1)).toBe("not_pending");
    expect(assignCounselor(refused, "conseillere", t1)).toBe("not_pending");
  });

  it("après l'accord, l'administration attribue le conseiller ; avant, rien", () => {
    expect(assignCounselor(requested, "conseillere", t0)).toBe("not_accepted");
    const accepted = answerAccess(requested, "koffi", true, false, t0) as CounselorAccess;
    expect(accepted.status).toBe("requested");
    expect(counselorCanRead(accepted, t1)).toBe(false);
    expect(answerAccess(accepted, "koffi", true, false, t1)).toBe("not_pending");
    const granted = assignCounselor(accepted, "conseillere", t0) as CounselorAccess;
    expect(granted).toMatchObject({ status: "granted", counselorId: "conseillere" });
    expect(showCounselorBanner(granted)).toBe(true);
  });

  it("à partir de son arrivée ; l'historique seulement si les deux l'ont accepté", () => {
    expect(counselorReadableSince(grantedWith(false))).toEqual(t0);
    expect(counselorCanRead(grantedWith(false), before)).toBe(false);
    expect(counselorCanRead(grantedWith(false), t1)).toBe(true);
    expect(counselorReadableSince(grantedWith(true))).toBe("all");
    expect(counselorCanRead(grantedWith(true), before)).toBe(true);
    expect(counselorCanRead(grantedWith(true, false), before)).toBe(false);
  });

  it("retrait par l'un ou l'autre, effet immédiat", () => {
    const granted = grantedWith(true);
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
