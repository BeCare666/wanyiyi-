import { describe, expect, it } from "vitest";
import { conversationHref, type ConversationRow, initial, splitConversations } from "../src/app/[locale]/(membre)/espace/discussions/discussions";
import { isMemberNavActive, memberNav } from "../src/components/member/memberNav";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import yo from "../messages/yo.json";

/** Menu « Discussions » (demande du 13/11/2026). */

const row = (over: Partial<ConversationRow>): ConversationRow => ({
  kind: "discovery",
  conversation_id: "c",
  target_id: "t",
  title: "Afiavi",
  last_body: null,
  last_is_system: null,
  last_from_me: null,
  last_at: null,
  unread: 0,
  read_only: false,
  ends_at: null,
  delete_after: null,
  ...over,
});

describe("Discussions", () => {
  it("ouvre la page qui existe déjà pour chaque espace", () => {
    expect(conversationHref(row({ kind: "discovery", target_id: "d1" }))).toEqual({ pathname: "/espace/matchs/d1", tab: "discussion" });
    expect(conversationHref(row({ kind: "discovery_ended", target_id: "d2" }))).toEqual({ pathname: "/espace/matchs/d2", tab: "discussion" });
    expect(conversationHref(row({ kind: "couple" }))).toEqual({ pathname: "/espace/couple", tab: "discussion" });
    expect(conversationHref(row({ kind: "counsel" }))).toEqual({ pathname: "/espace/conseiller" });
  });

  it("en cours d'abord, la plus récente en haut ; les terminées à part", () => {
    const { current, ended } = splitConversations([
      row({ conversation_id: "old", last_at: "2026-11-10T10:00:00Z" }),
      row({ conversation_id: "fin", kind: "discovery_ended", last_at: "2026-11-12T10:00:00Z" }),
      row({ conversation_id: "new", kind: "couple", last_at: "2026-11-12T09:00:00Z" }),
      row({ conversation_id: "empty", kind: "counsel" }),
    ]);
    expect(current.map((r) => r.conversation_id)).toEqual(["new", "old", "empty"]);
    expect(ended.map((r) => r.conversation_id)).toEqual(["fin"]);
  });

  it("initiale de l'avatar", () => {
    expect(initial("ébène")).toBe("É");
    expect(initial(null)).toBe("·");
  });

  it("entrée de menu active sur la page", () => {
    expect(isMemberNavActive(memberNav.discussions, "/espace/discussions")).toBe(true);
    expect(isMemberNavActive(memberNav.matches, "/espace/discussions")).toBe(false);
  });

  it("textes présents dans les trois langues", () => {
    for (const m of [fr, en, yo]) {
      expect(m.Member.nav.discussions).toBeTruthy();
      expect(Object.keys(m.Member.inbox).sort()).toEqual(Object.keys(fr.Member.inbox).sort());
      expect(Object.keys(m.Member.inbox.kinds).sort()).toEqual(["counsel", "couple", "discovery", "discovery_ended"]);
    }
  });
});
