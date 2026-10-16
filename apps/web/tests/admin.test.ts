import { describe, expect, it } from "vitest";
import { ageOn, filterQueue, memberName, parseQueueFilter, type QueueRow } from "../src/app/[locale]/(admin)/admin/verifications/queue";
import { isAdminNavActive, visibleAdminNav } from "../src/components/admin/adminNav";

describe("Menu de l'administration (11.1)", () => {
  it("n'affiche que les modules permis au rôle, sans groupe vide", () => {
    // Administration : permission de vérification
    expect(visibleAdminNav(["verifications.review", "events.manage"]).map((g) => g.items.map((i) => i.key))).toEqual([["verifications"]]);
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
