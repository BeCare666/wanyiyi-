import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEBATE_TOPICS, isTopicSet, readTopics } from "../src/lib/topics";

/** Sujets de débat des soirées (06/11/2026) : même liste que la base, textes dans les trois langues. */

const migration = readFileSync(join(__dirname, "../../../supabase/migrations/20261106000000_samedis_trois_matchs.sql"), "utf8");

describe("Sujets de débat", () => {
  it("même liste, dans le même ordre, que la table app.debate_topics", () => {
    const inSql = [...migration.matchAll(/\('([a-z_]+)', (\d+)\)/g)].map((m) => ({ key: m[1]!, position: Number(m[2]) }));
    expect(inSql.map((t) => t.key)).toEqual([...DEBATE_TOPICS]);
    expect(inSql.map((t) => t.position)).toEqual(DEBATE_TOPICS.map((_, i) => i + 1));
    expect(DEBATE_TOPICS).toHaveLength(24);
  });

  it("chaque sujet a son texte en français, en anglais et en yoruba, sans tiret long", () => {
    for (const locale of ["fr", "en", "yo"]) {
      const topics = JSON.parse(readFileSync(join(__dirname, `../messages/${locale}.json`), "utf8")).Topics as Record<string, string>;
      expect(Object.keys(topics).sort()).toEqual([...DEBATE_TOPICS].sort());
      for (const text of Object.values(topics)) {
        expect(text.length).toBeGreaterThan(5);
        expect(text).not.toMatch(/[—–]/);
      }
    }
  });

  it("quatre sujets différents de la liste ; une valeur inconnue venue de la base n'est pas affichée", () => {
    expect(isTopicSet(["respect", "forgiveness", "phone_time", "travel_dreams"])).toBe(true);
    expect(isTopicSet(["respect", "respect", "phone_time", "travel_dreams"])).toBe(false);
    expect(isTopicSet(["respect", "forgiveness", "phone_time"])).toBe(false);
    expect(isTopicSet(["respect", "forgiveness", "phone_time", "inconnu"])).toBe(false);
    expect(isTopicSet("respect")).toBe(false);
    expect(readTopics(["respect", "inconnu", "phone_time"])).toEqual(["respect", "phone_time"]);
    expect(readTopics(null)).toEqual([]);
  });
});
