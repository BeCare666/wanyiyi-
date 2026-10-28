import { describe, expect, it } from "vitest";
import { checkPayout, checkSettings } from "../src/app/[locale]/(admin)/admin/cagnottes/cagnottes";
import { visibleAdminNav } from "../src/components/admin/adminNav";
import { cagnottesSpec, listSpecs } from "../src/components/admin/listRules";
import { notificationHref } from "../src/components/member/notificationKinds";
import {
  cagnotteUrl,
  cagnotteView,
  canProposeCagnotte,
  checkContribution,
  checkProposal,
  type MyCagnotte,
  payoutPhone,
  progressPercent,
  whatsappShare,
} from "../src/lib/cagnotte";

/** Cagnotte (phase 4, question 3) : ce que le couple voit et peut faire, contrôles, administration. */

const base: MyCagnotte = {
  id: "g",
  status: "open",
  title: "Notre mariage",
  goal_xof: 500000,
  closes_at: "2026-12-31T23:00:00Z",
  opened_at: "2026-10-28T10:00:00Z",
  public_token: "a".repeat(64),
  payout_phone: "+2290197000001",
  commission_percent: "0",
  collected_xof: 0,
  proposed_by_me: true,
  my_requests: [],
  payout_pending: false,
  paid_out_xof: 0,
  closed_reason: null,
};

describe("état de la cagnotte pour le membre", () => {
  it("proposition à accepter par l'autre, ouverte, close, reversée", () => {
    expect(cagnotteView(null)).toBe("propose");
    expect(cagnotteView({ ...base, status: "proposed" })).toBe("waitingOther");
    expect(cagnotteView({ ...base, status: "proposed", proposed_by_me: false })).toBe("toAnswer");
    expect(cagnotteView(base)).toBe("open");
    expect(cagnotteView({ ...base, status: "closed" })).toBe("closed");
    expect(cagnotteView({ ...base, status: "paid_out" })).toBe("paidOut");
  });

  it("proposition possible après « Dot ou mariage » ou l'union, sans cagnotte en cours", () => {
    const input = { status: "active", blocked: false, dowryOrWeddingReached: true, view: "propose" as const };
    expect(canProposeCagnotte(input)).toBe(true);
    expect(canProposeCagnotte({ ...input, dowryOrWeddingReached: false })).toBe(false);
    expect(canProposeCagnotte({ ...input, status: "union_celebrated", dowryOrWeddingReached: false })).toBe(true);
    expect(canProposeCagnotte({ ...input, status: "paused" })).toBe(false);
    expect(canProposeCagnotte({ ...input, blocked: true })).toBe(false);
    expect(canProposeCagnotte({ ...input, view: "open" })).toBe(false);
    expect(canProposeCagnotte({ ...input, view: "closed" })).toBe(false);
    expect(canProposeCagnotte({ ...input, view: "paidOut" })).toBe(true);
  });
});

describe("contrôles", () => {
  const today = "2026-10-28";
  const proposal = { title: "Notre mariage", goal: "500 000", closesOn: "2026-12-31", phone: "+229 01 97 00 00 01" };

  it("proposition : titre, objectif, date dans les 90 jours, numéro du Bénin", () => {
    expect(checkProposal(proposal, today)).toBeNull();
    expect(checkProposal({ ...proposal, goal: "" }, today)).toBeNull();
    expect(checkProposal({ ...proposal, title: "Ab" }, today)).toBe("invalid_title");
    expect(checkProposal({ ...proposal, goal: "999" }, today)).toBe("invalid_goal");
    expect(checkProposal({ ...proposal, closesOn: "2026-10-27" }, today)).toBe("invalid_closing");
    // 89 jours après aujourd'hui : fin de journée à 90 jours pleins, comme la base
    expect(checkProposal({ ...proposal, closesOn: "2027-01-26" }, today)).toBe("invalid_closing");
    expect(checkProposal({ ...proposal, closesOn: "2027-01-25" }, today)).toBeNull();
    expect(checkProposal({ ...proposal, phone: "0197000001" }, today)).toBe("invalid_phone");
    expect(payoutPhone("229 01 97 00 00 01")).toBe("+2290197000001");
    expect(payoutPhone("+229 97 00 00 01")).toBe("+22997000001");
  });

  it("contribution : nom ou anonyme, message de 300 caractères, minimum réglé", () => {
    const input = { name: "Tante Rose", anonymous: false, message: "", amount: "5 000", hideAmount: false };
    expect(checkContribution(input, 1000)).toBeNull();
    expect(checkContribution({ ...input, name: "" }, 1000)).toBe("name_required");
    expect(checkContribution({ ...input, name: "", anonymous: true }, 1000)).toBeNull();
    expect(checkContribution({ ...input, message: "x".repeat(301) }, 1000)).toBe("message_too_long");
    expect(checkContribution({ ...input, amount: "999" }, 1000)).toBe("invalid_amount");
    expect(checkContribution({ ...input, amount: "1500.5" }, 1000)).toBe("invalid_amount");
  });

  it("progression, lien public et partage WhatsApp", () => {
    expect(progressPercent(150000, 500000)).toBe(30);
    expect(progressPercent(900000, 500000)).toBe(100);
    expect(progressPercent(1000, null)).toBeNull();
    const url = cagnotteUrl("https://ifedele.example/", "b".repeat(64));
    expect(url).toBe(`https://ifedele.example/cagnotte/${"b".repeat(64)}`);
    expect(whatsappShare("Participez :", url)).toBe(`https://wa.me/?text=${encodeURIComponent(`Participez : ${url}`)}`);
  });
});

describe("administration", () => {
  it("reversement saisi : au plus le brut moins la commission, référence obligatoire", () => {
    expect(checkPayout({ sent: "144 000", reference: "MP123" }, 146250)).toBeNull();
    expect(checkPayout({ sent: "150000", reference: "MP123" }, 146250)).toBe("invalid_amount");
    expect(checkPayout({ sent: "144000", reference: " " }, 146250)).toBe("reference_required");
  });

  it("réglages : minimum entier, commission de 0 à 50 % avec deux décimales", () => {
    expect(checkSettings({ min: "1000", commission: "0" })).toBeNull();
    expect(checkSettings({ min: "1000", commission: "2,5" })).toBeNull();
    expect(checkSettings({ min: "50", commission: "0" })).toBe("invalid_amount");
    expect(checkSettings({ min: "1000", commission: "51" })).toBe("invalid_commission");
    expect(checkSettings({ min: "1000", commission: "1.255" })).toBe("invalid_commission");
  });

  it("liste « cagnottes », menu « Célébration » et notifications vers l'espace du couple", () => {
    expect(listSpecs.cagnottes).toBe(cagnottesSpec);
    expect(visibleAdminNav(["cagnottes.manage"])[0]!.items.map((i) => i.href)).toEqual(["/admin/cagnottes"]);
    expect(notificationHref("cagnotte.contribution")).toEqual({ pathname: "/espace/couple" });
    expect(notificationHref("cagnotte.paid_out")).toEqual({ pathname: "/espace/couple" });
  });
});
