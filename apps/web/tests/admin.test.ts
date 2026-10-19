import { describe, expect, it } from "vitest";
import { ageOn, filterQueue, memberName, parseQueueFilter, type QueueRow } from "../src/app/[locale]/(admin)/admin/verifications/queue";
import { checkVenue } from "../src/app/[locale]/(admin)/admin/lieux/venues";
import {
  availableActions,
  historyKey,
  type MemberStatus,
  memberQueryParams,
  memberRpcArgs,
  pageCount,
  parseMemberQuery,
} from "../src/app/[locale]/(admin)/admin/membres/members";
import {
  canCheckIn,
  checkDraft,
  draftDefaults,
  type EventStatus,
  filterEvents,
  fromCotonouInput,
  groupParticipants,
  nextStep,
  type ParticipantRow,
  parseEventFilter,
  toCotonouInput,
} from "../src/app/[locale]/(admin)/admin/soirees/evenings";
import { canPrintTables, qrPath, voteUrl } from "../src/app/[locale]/(admin)/admin/soirees/tables";
import { parsePaymentQuery, paymentQueryParams, paymentRpcArgs, providerKey, refundState } from "../src/app/[locale]/(admin)/admin/paiements/payments";
import { isAdminNavActive, visibleAdminNav } from "../src/components/admin/adminNav";
import QRCode from "qrcode";

describe("Menu de l'administration (11.1)", () => {
  it("n'affiche que les modules permis au rôle, sans groupe vide", () => {
    // Administration : vérifications, soirées et lieux
    expect(visibleAdminNav(["verifications.review", "members.manage", "events.manage"]).map((g) => g.items.map((i) => i.key))).toEqual([
      ["members", "verifications"],
      ["evenings", "venues"],
    ]);
    expect(visibleAdminNav(["events.manage"]).map((g) => g.key)).toEqual(["evenings"]);
    expect(visibleAdminNav(["payments.read"]).map((g) => g.items.map((i) => i.href))).toEqual([["/admin/paiements"]]);
    // Modération : pas de vérification (décision du 17 octobre 2026)
    expect(visibleAdminNav(["profile_texts.review"])).toEqual([]);
  });

  it("entrée active sur sa page et ses fiches", () => {
    const [group] = visibleAdminNav(["verifications.review"]);
    const item = group!.items[0]!;
    expect(isAdminNavActive(item, "/admin/verifications")).toBe(true);
    expect(isAdminNavActive(item, "/admin/verifications/abc")).toBe(true);
    expect(isAdminNavActive(item, "/admin")).toBe(false);
  });
});

describe("File des vérifications (11.2-3)", () => {
  const row = (over: Partial<QueueRow>): QueueRow => ({
    verification_id: "v",
    user_id: "u",
    member_number: "W000001",
    first_name: "Afiwa",
    last_name: "Fictif",
    status: "pending",
    submitted_at: null,
    document_kind: "id_card",
    has_selfie: true,
    declared_status: "single",
    ready: true,
    ...over,
  });

  it("filtres lus dans l'adresse ; « complets » : en attente et complets seulement", () => {
    const rows = [row({ verification_id: "a" }), row({ verification_id: "b", ready: false }), row({ verification_id: "c", status: "to_correct" })];
    expect(parseQueueFilter("complets")).toBe("ready");
    expect(parseQueueFilter(["a-corriger"])).toBe("to_correct");
    expect(parseQueueFilter("inconnu")).toBe("all");
    expect(filterQueue(rows, "ready").map((r) => r.verification_id)).toEqual(["a"]);
    expect(filterQueue(rows, "pending").map((r) => r.verification_id)).toEqual(["a", "b"]);
    expect(filterQueue(rows, "to_correct").map((r) => r.verification_id)).toEqual(["c"]);
    expect(filterQueue(rows, "all")).toHaveLength(3);
  });

  it("nom complet pour l'équipe, rien si le profil n'existe pas", () => {
    expect(memberName({ first_name: "Afiwa", last_name: "Fictif" })).toBe("Afiwa Fictif");
    expect(memberName({ first_name: null, last_name: null })).toBeNull();
  });

  it("âge révolu à l'heure de Cotonou, la veille et le jour de l'anniversaire", () => {
    expect(ageOn("1994-05-14", new Date("2026-05-13T12:00:00Z"))).toBe(31);
    expect(ageOn("1994-05-14", new Date("2026-05-14T12:00:00Z"))).toBe(32);
    // 13 mai à 23 h 30 UTC : déjà le 14 mai à Cotonou
    expect(ageOn("1994-05-14", new Date("2026-05-13T23:30:00Z"))).toBe(32);
  });
});

describe("Soirées de l'administration (11.2-5)", () => {
  const ev = (status: EventStatus) => ({ status });

  it("filtres lus dans l'adresse", () => {
    const rows = (["draft", "published", "full", "in_progress", "finished", "cancelled"] as EventStatus[]).map(ev);
    expect(parseEventFilter("brouillons")).toBe("drafts");
    expect(parseEventFilter(["en-cours"])).toBe("live");
    expect(parseEventFilter("inconnu")).toBe("all");
    expect(filterEvents(rows, "upcoming").map((r) => r.status)).toEqual(["published", "full"]);
    expect(filterEvents(rows, "drafts").map((r) => r.status)).toEqual(["draft"]);
    expect(filterEvents(rows, "live").map((r) => r.status)).toEqual(["in_progress"]);
    expect(filterEvents(rows, "past").map((r) => r.status)).toEqual(["finished", "cancelled"]);
    expect(filterEvents(rows, "all")).toHaveLength(6);
  });

  it("déroulé : publier, préparer, commencer, terminer, calculer, puis plus rien", () => {
    expect(nextStep("draft", false, false)).toBe("publish");
    expect(nextStep("published", false, false)).toBe("prepare");
    expect(nextStep("full", true, false)).toBe("start");
    expect(nextStep("in_progress", true, false)).toBe("finish");
    expect(nextStep("finished", true, false)).toBe("compute");
    expect(nextStep("finished", true, true)).toBeNull();
    expect(nextStep("cancelled", false, false)).toBeNull();
  });

  it("pointage : place confirmée, soirée publiée, tables pas encore préparées", () => {
    expect(canCheckIn({ status: "confirmed" }, "published", false)).toBe(true);
    expect(canCheckIn({ status: "booked" }, "published", false)).toBe(false);
    expect(canCheckIn({ status: "confirmed" }, "published", true)).toBe(false);
    expect(canCheckIn({ status: "confirmed" }, "in_progress", false)).toBe(false);
  });

  it("heure de Cotonou (UTC+1) dans les deux sens, dates impossibles refusées", () => {
    expect(fromCotonouInput("2026-11-07T19:30")?.toISOString()).toBe("2026-11-07T18:30:00.000Z");
    expect(fromCotonouInput("2026-01-01T00:15")?.toISOString()).toBe("2025-12-31T23:15:00.000Z");
    expect(toCotonouInput(new Date("2026-11-07T18:30:00Z"))).toBe("2026-11-07T19:30");
    expect(fromCotonouInput("2026-02-31T19:00")).toBeNull();
    expect(fromCotonouInput("07/11/2026 19:30")).toBeNull();
    expect(fromCotonouInput("")).toBeNull();
  });

  it("contrôle du brouillon identique à la base : début futur, 1 à 12 places, durées, tarif", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    const ok = { venueId: null, themeId: null, startsAt: "2026-11-07T19:30", priceXof: null, ...draftDefaults };
    expect(checkDraft(ok, now)).toBeNull();
    expect(checkDraft({ ...ok, startsAt: "" }, now)).toBe("starts_at");
    expect(checkDraft({ ...ok, startsAt: "2026-10-19T11:00" }, now)).toBe("starts_in_past");
    expect(checkDraft({ ...ok, capacityWomen: 13 }, now)).toBe("invalid_capacity");
    expect(checkDraft({ ...ok, capacityMen: Number.NaN }, now)).toBe("invalid_capacity");
    expect(checkDraft({ ...ok, roundMinutes: 0 }, now)).toBe("invalid_duration");
    expect(checkDraft({ ...ok, changeoverMinutes: -1 }, now)).toBe("invalid_duration");
    expect(checkDraft({ ...ok, priceXof: -1 }, now)).toBe("invalid_price");
    expect(checkDraft({ ...ok, priceXof: 5000 }, now)).toBeNull();
    expect(draftDefaults).toEqual({ capacityWomen: 10, capacityMen: 10, roundMinutes: 7, changeoverMinutes: 1 });
  });

  it("inscriptions regroupées : places occupées, liste d'attente, puis le reste", () => {
    const p = (user_id: string, sex: "female" | "male", status: ParticipantRow["status"]): ParticipantRow => ({
      user_id,
      sex,
      status,
      member_number: null,
      first_name: null,
      last_name: null,
      waitlist_position: null,
      registered_at: "2026-10-01T10:00:00Z",
      confirmed_at: null,
      checked_in_at: null,
      seat_number: null,
    });
    const rows = [p("a", "female", "confirmed"), p("b", "female", "waitlisted"), p("c", "female", "released"), p("d", "male", "booked")];
    const women = groupParticipants(rows, "female");
    expect([women.seated, women.waiting, women.other].map((g) => g.map((r) => r.user_id))).toEqual([["a"], ["b"], ["c"]]);
    expect(groupParticipants(rows, "male").seated.map((r) => r.user_id)).toEqual(["d"]);
  });
});

describe("Codes QR des tables (11.2-5, question 20)", () => {
  it("adresse <domaine>/vote/<code>, barre finale du domaine ignorée", () => {
    expect(voteUrl("https://wanyiyi.example", "abcdef0123456789")).toBe("https://wanyiyi.example/vote/abcdef0123456789");
    expect(voteUrl("https://wanyiyi.example/", "abcdef0123456789")).toBe("https://wanyiyi.example/vote/abcdef0123456789");
  });

  it("imprimables une fois les tables préparées, jusqu'à la fin de la soirée", () => {
    expect(canPrintTables("published", false)).toBe(false);
    for (const status of ["published", "full", "in_progress"] as const) expect(canPrintTables(status, true)).toBe(true);
    for (const status of ["draft", "finished", "cancelled"] as const) expect(canPrintTables(status, true)).toBe(false);
  });

  it("un carré par module sombre du code, pour un code QR de taille valide", () => {
    const url = voteUrl("https://wanyiyi.example", "abcdef0123456789abcdef0123456789");
    const { size, path } = qrPath(url);
    const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
    expect(size).toBe(modules.size);
    expect((size - 17) % 4).toBe(0);
    expect(path.match(/M/g)?.length).toBe(Array.from(modules.data).filter(Boolean).length);
    expect(path).not.toMatch(/#|rgb/);
  });
});

describe("Paiements (11.2-9)", () => {
  it("filtres lus dans l'adresse, valeurs inconnues ignorées, pagination", () => {
    const query = parsePaymentQuery({ q: " sim_1 ", etat: "succeeded", objet: "evening_booking", remboursement: "requested", page: "3" });
    expect(query).toEqual({ search: "sim_1", status: "succeeded", purpose: "evening_booking", refund: "requested", page: 3 });
    expect(paymentRpcArgs(query)).toMatchObject({ p_search: "sim_1", p_refund: "requested", p_limit: 50, p_offset: 100 });
    expect(paymentQueryParams(query, 1)).toEqual({ q: "sim_1", etat: "succeeded", objet: "evening_booking", remboursement: "requested" });
    expect(parsePaymentQuery({ etat: "paid", objet: "x", remboursement: "oui", page: "-2" })).toEqual({ search: "", status: null, purpose: null, refund: null, page: 1 });
  });

  it("remboursement demandé tant que le prestataire ne l'a pas exécuté ; prestataire inconnu générique", () => {
    expect(refundState({ status: "succeeded", refund_requested_at: "2026-10-19T10:00:00Z" })).toBe("requested");
    expect(refundState({ status: "refunded", refund_requested_at: "2026-10-19T10:00:00Z" })).toBe("refunded");
    expect(refundState({ status: "succeeded", refund_requested_at: null })).toBeNull();
    expect(providerKey("simulated")).toBe("simulated");
    expect(providerKey("autre")).toBe("other");
  });
});

describe("Lieux (11.2-5)", () => {
  it("nom, adresse et ville obligatoires", () => {
    const venue = { name: "Maison Akpakpa (lieu fictif)", address: "Adresse fictive", city: "Cotonou", isPartner: true };
    expect(checkVenue(venue)).toBeNull();
    expect(checkVenue({ ...venue, name: "  " })).toBe("name");
    expect(checkVenue({ ...venue, address: "" })).toBe("address");
    expect(checkVenue({ ...venue, city: "" })).toBe("city");
  });
});

describe("Membres (11.2-2)", () => {
  it("filtres lus dans l'adresse, valeurs inconnues ignorées, pagination", () => {
    const q = parseMemberQuery({ q: "  Afiwa ", etat: "suspended", role: "pirate", sexe: ["female"], page: "3" });
    expect(q).toEqual({ search: "Afiwa", status: "suspended", role: null, sex: "female", page: 3 });
    expect(parseMemberQuery({ page: "-2" }).page).toBe(1);
    expect(memberRpcArgs(q)).toEqual({ p_search: "Afiwa", p_status: "suspended", p_role: null, p_sex: "female", p_limit: 50, p_offset: 100 });
    expect(memberQueryParams(q, 1)).toEqual({ q: "Afiwa", etat: "suspended", sexe: "female" });
    expect(memberQueryParams(q, 4)).toMatchObject({ page: "4" });
    expect([pageCount(0), pageCount(50), pageCount(51)]).toEqual([1, 1, 2]);
  });

  it("actions selon l'état, jamais sur son propre compte ; rôle réservé à la super administration", () => {
    const card = (status: MemberStatus | null) => ({ user_id: "m", status });
    expect(availableActions(card("verified"), "admin", false)).toEqual({ suspend: true, reactivate: false, exclude: true, blockEvenings: true, role: false });
    expect(availableActions(card("suspended"), "admin", true)).toEqual({ suspend: false, reactivate: true, exclude: true, blockEvenings: true, role: true });
    expect(availableActions(card("excluded"), "admin", true)).toEqual({ suspend: false, reactivate: false, exclude: false, blockEvenings: false, role: true });
    expect(availableActions(card("verified"), "m", true)).toMatchObject({ suspend: false, exclude: false, role: false });
    expect(availableActions(card(null), "admin", false)).toMatchObject({ suspend: false, exclude: false, blockEvenings: false });
  });

  it("historique : types connus traduits, les autres génériques", () => {
    expect(historyKey("evening.checked_in")).toBe("evening_checked_in");
    expect(historyKey("sanction.suspension")).toBe("sanction_suspension");
    expect(historyKey("vote.cast")).toBe("other");
  });
});
