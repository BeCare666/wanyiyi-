import { describe, expect, it } from "vitest";
import {
  availableDecisions,
  canAddUnionPhoto,
  canInviteCounselor,
  chatOpen,
  chatReadable,
  type CounselorAccess,
  counselorState,
  cotonouToIso,
  isLive,
  type MemoryPhotoRow,
  milestoneState,
} from "../src/app/[locale]/(membre)/espace/couple/couple";
import { systemMessage } from "../src/components/member/chatSystem";
import { notificationHref } from "../src/components/member/notificationKinds";

/** Espace du couple (9.5 ; questions 6, 7, 9 et 10 d de la phase 3) : ce que le membre voit et peut faire. */

const me = "moi";
const other = "autre";
const access = (over: Partial<CounselorAccess>): CounselorAccess => ({
  id: "a",
  status: "requested",
  requested_by: me,
  accepted_at: null,
  price_xof: null,
  ...over,
});

describe("état du couple", () => {
  it("conversation : envoi pendant le couple en cours seulement ; lecture aussi en pause et après l'union", () => {
    expect(chatOpen({ status: "active", blocked: false })).toBe(true);
    expect(chatOpen({ status: "active", blocked: true })).toBe(false);
    expect(chatOpen({ status: "paused", blocked: false })).toBe(false);
    expect(chatReadable("union_celebrated")).toBe(true);
    expect(chatReadable("separated")).toBe(false);
    expect(chatReadable("left")).toBe(false);
    expect(isLive("paused")).toBe(true);
    expect(isLive("union_celebrated")).toBe(false);
  });

  it("décisions possibles selon l'état (question 7)", () => {
    expect(availableDecisions({ status: "active" })).toEqual(["union", "separation"]);
    expect(availableDecisions({ status: "paused" })).toEqual(["resume", "union", "separation"]);
    expect(availableDecisions({ status: "union_celebrated" })).toEqual(["keep_chat"]);
    expect(availableDecisions({ status: "left" })).toEqual([]);
  });
});

describe("conseiller (question 9)", () => {
  it("invitation, réponse, paiement par celui qui invite, attribution", () => {
    expect(counselorState(null, me, false)).toBe("none");
    expect(counselorState(access({ status: "revoked" }), me, false)).toBe("none");
    expect(counselorState(access({ status: "refused" }), me, false)).toBe("none");
    expect(counselorState(access({}), me, false)).toBe("waitingOther");
    expect(counselorState(access({ requested_by: other }), me, false)).toBe("toAnswer");
    const accepted = access({ accepted_at: "2026-10-26T10:00:00Z", price_xof: 5000 });
    expect(counselorState(accepted, me, false)).toBe("toPay");
    expect(counselorState({ ...accepted, requested_by: other }, me, false)).toBe("waitingPayment");
    expect(counselorState(accepted, me, true)).toBe("awaitingAssignment");
    expect(counselorState({ ...accepted, price_xof: 0 }, me, false)).toBe("awaitingAssignment");
    expect(counselorState(access({ status: "granted" }), me, false)).toBe("granted");
  });

  it("inviter : couple en cours ou en pause, non bloqué, sans accès en cours", () => {
    expect(canInviteCounselor({ status: "active", blocked: false }, "none")).toBe(true);
    expect(canInviteCounselor({ status: "paused", blocked: false }, "none")).toBe(true);
    expect(canInviteCounselor({ status: "active", blocked: true }, "none")).toBe(false);
    expect(canInviteCounselor({ status: "active", blocked: false }, "granted")).toBe(false);
    // Suivi post-union (phase 4, question 1 d) ; pas après une séparation
    expect(canInviteCounselor({ status: "union_celebrated", blocked: false }, "none")).toBe(true);
    expect(canInviteCounselor({ status: "separated", blocked: false }, "none")).toBe(false);
  });
});

describe("rendez-vous déclarés", () => {
  it("date et heure lues à l'heure de Cotonou (UTC+1)", () => {
    expect(cotonouToIso("2026-11-02T19:30")).toBe("2026-11-02T18:30:00.000Z");
    expect(cotonouToIso("2026-11-01T00:15")).toBe("2026-10-31T23:15:00.000Z");
    expect(cotonouToIso("2026-02-31T10:00")).toBeNull();
    expect(cotonouToIso("2026-11-02T24:00")).toBeNull();
    expect(cotonouToIso("demain")).toBeNull();
  });
});

describe("notifications du couple", () => {
  it("mènent à l'espace du couple", () => {
    for (const kind of ["couple.opened", "counselor_access.requested", "counselor_access.payment_due", "couple.paused", "couple.blocked"]) {
      expect(notificationHref(kind)).toEqual({ pathname: "/espace/couple" });
    }
    expect(notificationHref("couple.separated")).toBeNull();
    // « Bien rentré(e) ? » : réponse sur le tableau de bord
    expect(notificationHref("date.checkin")).toEqual({ pathname: "/espace" });
    expect(notificationHref("date.help_requested")).toBeNull();
  });
});

describe("parcours (question 16)", () => {
  const row = (over: object) => ({ kind: "first_dates" as const, reached_at: null, i_confirmed_reach: false, i_confirmed_remove: false, ...over });
  it("confirmation à deux ; séances automatiques", () => {
    expect(milestoneState(row({}))).toBe("reach");
    expect(milestoneState(row({ i_confirmed_reach: true }))).toBe("waitingReach");
    expect(milestoneState(row({ reached_at: "2026-10-20T11:00:00Z" }))).toBe("reached");
    expect(milestoneState(row({ reached_at: "2026-10-20T11:00:00Z", i_confirmed_remove: true }))).toBe("waitingRemove");
    expect(milestoneState(row({ kind: "counselor_sessions" }))).toBe("auto");
  });

  it("messages système avec l'étape", () => {
    expect(systemMessage("milestone.reached:celebration")).toEqual({ key: "milestone_reached", step: "celebration" });
    expect(systemMessage("couple.paused")).toEqual({ key: "couple_paused", step: null });
    expect(systemMessage("milestone.reached:inconnue")).toBeNull();
    expect(systemMessage("autre.code")).toBeNull();
  });
});

describe("espace souvenir (phase 4, question 1)", () => {
  const photo = (mine: boolean, review_status: MemoryPhotoRow["review_status"]): MemoryPhotoRow => ({
    photo_id: Math.random().toString(),
    mine,
    review_status,
    review_note: null,
    created_at: "2026-11-01T10:00:00Z",
  });

  it("photos de l'union : après l'union, 3 par membre, une photo refusée libère sa place", () => {
    expect(canAddUnionPhoto("active", [])).toBe(false);
    expect(canAddUnionPhoto("union_celebrated", [photo(true, "approved"), photo(true, "pending"), photo(false, "approved")])).toBe(true);
    expect(canAddUnionPhoto("union_celebrated", [photo(true, "approved"), photo(true, "pending"), photo(true, "pending")])).toBe(false);
    expect(canAddUnionPhoto("union_celebrated", [photo(true, "approved"), photo(true, "pending"), photo(true, "rejected")])).toBe(true);
  });

  it("photo de l'union refusée : la notification mène à l'espace", () => {
    expect(notificationHref("couple.union_photo_rejected")).toEqual({ pathname: "/espace/couple" });
  });
});
