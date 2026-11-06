import { describe, expect, it } from "vitest";
import {
  canAskExtension,
  chatTimeLabel,
  daysLeft,
  type DiscoveryRow,
  groupBySection,
  sectionOf,
  sortChats,
} from "../src/app/[locale]/(membre)/espace/matchs/discoveries";
import { chatDayKey, groupChat, isReadByPartner } from "../src/components/member/chatLayout";

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
  it("sections : ancien match en attente, en cours, couple, terminées (plus de choix depuis le 06/11/2026)", () => {
    expect(sectionOf(row({}), now)).toBe("waiting");
    expect(sectionOf(row({ chosen_by_me: true }), now)).toBe("waiting");
    expect(sectionOf(row({ pending_expires_at: "2026-10-26T09:59:00Z" }), now)).toBe("ended");
    expect(sectionOf(row({ match_status: "expired" }), now)).toBe("ended");
    expect(sectionOf(row({ match_status: "discovery_open", discovery_status: "active" }), now)).toBe("active");
    expect(sectionOf(row({ match_status: "discovery_open", discovery_status: "extended" }), now)).toBe("active");
    expect(sectionOf(row({ match_status: "discovery_open", discovery_status: "continued" }), now)).toBe("couple");
    expect(sectionOf(row({ match_status: "closed", discovery_status: "expired" }), now)).toBe("ended");
    const groups = groupBySection([row({ match_id: "a" }), row({ match_id: "b", chosen_by_me: true })], now);
    expect(groups.waiting.map((r) => r.match_id)).toEqual(["a", "b"]);
    expect(Object.keys(groups).sort()).toEqual(["active", "couple", "ended", "waiting"]);
  });

  it("jours restants arrondis au jour supérieur, jamais négatifs", () => {
    expect(daysLeft("2026-11-09T10:00:00Z", now)).toBe(14);
    expect(daysLeft("2026-10-26T11:00:00Z", now)).toBe(1);
    expect(daysLeft("2026-10-25T10:00:00Z", now)).toBe(0);
  });

  it("une seule prolongation, pendant les 4 derniers jours", () => {
    // Question 3 : seulement pendant les 4 derniers jours (ou pour retirer sa demande)
    expect(canAskExtension(row({ discovery_status: "active", ends_at: "2026-11-05T10:00:00Z" }), now)).toBe(false);
    expect(canAskExtension(row({ discovery_status: "active", ends_at: "2026-10-30T10:00:00Z" }), now)).toBe(true);
    expect(canAskExtension(row({ discovery_status: "active", ends_at: "2026-11-05T10:00:00Z", i_want_extension: true }), now)).toBe(true);
    expect(canAskExtension(row({ discovery_status: "active", ends_at: "2026-10-26T09:00:00Z" }), now)).toBe(false);
    expect(canAskExtension(row({ discovery_status: "extended", extended: true, ends_at: "2026-10-28T10:00:00Z" }), now)).toBe(false);
  });
});

describe("Discussions façon WhatsApp (06/11/2026)", () => {
  it("liste : la discussion au message le plus récent en haut, sinon la plus récemment ouverte", () => {
    const a = { discovery_id: "a", opened_at: "2026-10-20T10:00:00Z" };
    const b = { discovery_id: "b", opened_at: "2026-10-25T10:00:00Z" };
    const c = { discovery_id: "c", opened_at: "2026-10-22T10:00:00Z" };
    expect(sortChats([a, b, c], [{ discovery_id: "a", last_at: "2026-10-26T09:00:00Z" }]).map((r) => r.discovery_id)).toEqual(["a", "b", "c"]);
    expect(sortChats([a, b, c], []).map((r) => r.discovery_id)).toEqual(["b", "c", "a"]);
  });

  it("heure du dernier message : heure aujourd'hui, « hier », puis la date (heure de Cotonou)", () => {
    expect(chatTimeLabel("2026-10-26T08:00:00Z", now).kind).toBe("time");
    expect(chatTimeLabel("2026-10-25T23:30:00Z", now).kind).toBe("time"); // 0 h 30 à Cotonou : déjà le 26
    expect(chatTimeLabel("2026-10-25T22:30:00Z", now).kind).toBe("yesterday"); // 23 h 30 à Cotonou, le 25
    expect(chatTimeLabel("2026-10-25T08:00:00Z", now).kind).toBe("yesterday");
    expect(chatTimeLabel("2026-10-20T08:00:00Z", now).kind).toBe("date");
  });

  it("séparateur par jour et groupes de messages du même auteur", () => {
    const m = (id: string, sender: string | null, at: string, is_system = false) => ({ id, sender_id: sender, created_at: at, is_system });
    const list = [
      m("1", "me", "2026-10-25T10:00:00Z"),
      m("2", "me", "2026-10-25T10:01:00Z"),
      m("3", "her", "2026-10-25T10:02:00Z"),
      m("4", "her", "2026-10-26T08:00:00Z"),
      m("5", null, "2026-10-26T08:01:00Z", true),
      m("6", "her", "2026-10-26T08:02:00Z"),
    ];
    expect(groupChat(list).map((x) => [x.message.id, x.newDay, x.firstOfGroup])).toEqual([
      ["1", true, true],
      ["2", false, false],
      ["3", false, true],
      ["4", true, true],
      ["5", false, true],
      ["6", false, true],
    ]);
    expect(chatDayKey("2026-10-25T23:30:00Z")).toBe("2026-10-26");
  });

  it("lu (✓✓) : ouvert par l'autre après l'envoi, ou l'autre a répondu depuis", () => {
    const mine = { id: "1", sender_id: "me", created_at: "2026-10-26T08:00:00Z" };
    const reply = { id: "2", sender_id: "her", created_at: "2026-10-26T08:05:00Z" };
    const system = { id: "3", sender_id: null, created_at: "2026-10-26T08:06:00Z", is_system: true };
    expect(isReadByPartner(mine, [mine], "me", null)).toBe(false);
    expect(isReadByPartner(mine, [mine], "me", "2026-10-26T07:59:00Z")).toBe(false);
    expect(isReadByPartner(mine, [mine], "me", "2026-10-26T08:00:30Z")).toBe(true);
    expect(isReadByPartner(mine, [mine, system], "me", null)).toBe(false);
    expect(isReadByPartner(mine, [mine, reply], "me", null)).toBe(true);
  });
});
