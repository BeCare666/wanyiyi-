import { describe, expect, it } from "vitest";
import { canAskExtension, canChoose, daysLeft, type DiscoveryRow, groupBySection, sectionOf } from "../src/app/[locale]/(membre)/espace/matchs/discoveries";

/** Mes matchs et découvertes (9.4, question 2 de la phase 3) : sections, jours restants, actions possibles. */

const now = new Date("2026-10-26T10:00:00Z");
const row = (over: Partial<DiscoveryRow>): DiscoveryRow => ({
  match_id: "m",
  discovery_id: null,
  partner_first_name: "Koffi",
  announced_at: "2026-10-25T07:00:00Z",
  match_status: "pending_choice",
  pending_expires_at: "2026-11-01T07:00:00Z",
  chosen_by_me: false,
  discovery_status: null,
  opened_at: null,
  ends_at: null,
  extended: false,
  i_want_to_continue: false,
  i_want_extension: false,
  free_slots: 2,
  ...over,
});

describe("Mes matchs et découvertes (9.4)", () => {
  it("sections : à ouvrir, en attente de l'autre, en cours, couple, terminées", () => {
    expect(sectionOf(row({}), now)).toBe("toChoose");
    expect(sectionOf(row({ chosen_by_me: true }), now)).toBe("waiting");
    expect(sectionOf(row({ pending_expires_at: "2026-10-26T09:59:00Z" }), now)).toBe("ended");
    expect(sectionOf(row({ match_status: "expired" }), now)).toBe("ended");
    expect(sectionOf(row({ match_status: "discovery_open", discovery_status: "active" }), now)).toBe("active");
    expect(sectionOf(row({ match_status: "discovery_open", discovery_status: "extended" }), now)).toBe("active");
    expect(sectionOf(row({ match_status: "discovery_open", discovery_status: "continued" }), now)).toBe("couple");
    expect(sectionOf(row({ match_status: "closed", discovery_status: "expired" }), now)).toBe("ended");
    const groups = groupBySection([row({ match_id: "a" }), row({ match_id: "b", chosen_by_me: true })], now);
    expect(groups.toChoose.map((r) => r.match_id)).toEqual(["a"]);
    expect(groups.waiting.map((r) => r.match_id)).toEqual(["b"]);
  });

  it("jours restants arrondis au jour supérieur, jamais négatifs", () => {
    expect(daysLeft("2026-11-09T10:00:00Z", now)).toBe(14);
    expect(daysLeft("2026-10-26T11:00:00Z", now)).toBe(1);
    expect(daysLeft("2026-10-25T10:00:00Z", now)).toBe(0);
  });

  it("choisir seulement avec une place ; une seule prolongation", () => {
    expect(canChoose(row({ free_slots: 0 }))).toBe(false);
    expect(canChoose(row({ free_slots: 1 }))).toBe(true);
    expect(canAskExtension(row({ discovery_status: "active" }))).toBe(true);
    expect(canAskExtension(row({ discovery_status: "extended", extended: true }))).toBe(false);
  });
});
