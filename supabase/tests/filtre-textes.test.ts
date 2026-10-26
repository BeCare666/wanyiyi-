import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFreeText } from "../../packages/domain/src/textGuard";
import { asUser, createDb, failure } from "./db";
import { createMember } from "./fixtures";

/**
 * Blocage des coordonnées dans les textes du profil (8.1), refait dans la base : mêmes résultats
 * que le filtre de l'API (checkFreeText), et écriture directe d'un membre refusée.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const CASES = [
  // Textes du test de l'API (packages/domain/tests/textGuard.test.ts)
  "J'ai 34 ans, deux frères, et j'aime cuisiner le dimanche en famille.",
  "Je travaille dans la santé depuis 2015 et je chante à la chorale.",
  "Appelez-moi au 0197123456",
  "mon numéro : 01 97 12 34 56",
  "+229 01 97 12 34 56",
  "01.97.12-34-56",
  "O1 97 12 34 56",
  "zéro un neuf sept un deux trois quatre cinq six",
  "zéro un quatre-vingt-dix-sept douze trente-quatre cinquante-six",
  "01 quatre-vingt-dix-sept 12 34 56",
  "zero one nine seven one two three four five six",
  "écrivez à afiwa.h@gmail.com",
  "afiwa arobase gmail point com",
  "afiwa (at) gmail (dot) com",
  "voir https://exemple.bj/profil",
  "www.monsite.com",
  "wa.me/22901971234",
  "suivez @afiwa_cotonou",
  "insta: afiwa.h",
  "Snapchat = koffi229",
  "Je passe peu de temps sur Instagram, je préfère lire.",
  // Cas limites
  "ÉCRIVEZ À AFIWA@GMAIL.COM",
  "WWW.SITE.BJ",
  "Je vis à Porto-Novo. J'aime la musique.",
  "café.com",
  "écom.com",
  "a-b.com",
  "x -site.com",
  "x-site.com",
  "_x.com",
  "mawu.africa!",
  "IG: afi",
  "igloo: rien",
  "tik tok @ koffi",
  "snap->koffi",
  "whatsapp = 97",
  "x@ab",
  "(@abc",
  "a@b",
  "mon numéro: zéro un, quatre vingt dix sept, douze, trente quatre, cinquante six",
  "soixante et onze, quatre-vingts, soixante-dix-neuf",
  "trente ans et quarante amis",
  "un deux trois quatre cinq six sept",
  "un deux trois quatre cinq six sept huit",
  "odo okan esan eje okan eji eta erin",
  "1 ((2 3 4 5 6 7 8",
  "+229(01)97 12 34 56",
  "o1o2o3o4",
  "1234567",
  "12345678",
  "née en 1990, 2 enfants, 3 frères",
  "dix dix dix dix",
  "quatre - vingt dix sept",
  "",
  "Kémi, 28 ans, Abomey-Calavi.",
];

/** Textes générés (graine fixe) à partir de morceaux qui sollicitent chaque règle. */
function generated(count: number): string[] {
  const parts = [
    "un", "deux", "zéro", "neuf", "dix", "sept", "quatre", "-", "vingt", "trente", "et", "onze", "seize", "soixante",
    "one", "oh", "eji", "esan", "0", "1", "97", "229", "+", "(", ")", ".", " ", " ", " ", ",", "_", "/", "o", "O",
    "@", "at", "arobase", "point", "dot", "gmail", "com", "bj", "www", "http://", "wa", "me", "insta", "fb", ":", "=",
    "->", "afiwa", "é", "Je", "suis", "Cotonou", "x", "ig",
  ];
  let seed = 20261026;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Array.from({ length: count }, () => {
    const length = 2 + Math.floor(random() * 14);
    let text = "";
    for (let k = 0; k < length; k++) text += parts[Math.floor(random() * parts.length)];
    return text.slice(0, 300);
  });
}

async function sqlIssues(texts: string[]): Promise<string[][]> {
  const { rows } = await db.query<{ issues: string[] }>(
    "select app.text_contact_issues(t) as issues from unnest($1::text[]) with ordinality as u(t, n) order by n",
    [texts],
  );
  return rows.map((r) => r.issues);
}

describe("Filtre des textes dans la base (8.1)", () => {
  it("mêmes résultats que le filtre de l'API, sur les cas connus et 400 textes générés", async () => {
    const texts = [...CASES, ...generated(400)];
    const expected = texts.map((t) => checkFreeText(t).filter((issue) => issue !== "too_long"));
    const actual = await sqlIssues(texts);
    const differences = texts
      .map((text, k) => ({ text, api: expected[k], base: actual[k] }))
      .filter((d) => JSON.stringify(d.api) !== JSON.stringify(d.base));
    expect(differences).toEqual([]);
    // Le corpus exerce bien chaque règle
    const flagged = new Set(expected.flat());
    expect([...flagged].sort()).toEqual(["email", "link", "phone", "social_handle"]);
  });

  it("écriture directe d'un membre : refusée avec coordonnées, acceptée sinon ; relecture non bloquée", async () => {
    const member = await createMember(db, { firstName: "Afiwa", sex: "female" });
    const moderator = await createMember(db, { firstName: "Sèna", sex: "male", role: "moderator" });
    const insert = "insert into app.profile_texts (user_id, field, body) values ($1, 'who_i_am', $2)";

    expect(await asUser(db, member, (tx) => failure(tx.query(insert, [member, "Appelez-moi au 01 97 12 34 56"])))).toMatch(/text_rejected/);
    expect(await asUser(db, member, (tx) => failure(tx.query(insert, [member, "insta: afiwa.h"])))).toMatch(/text_rejected/);

    await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: member, role: "authenticated" })]);
      await tx.exec("set local role authenticated");
      await tx.query(insert, [member, "Calme et souriante, j'aime lire."]);
    });
    const update = "update app.profile_texts set body = $2 where user_id = $1";
    expect(await asUser(db, member, (tx) => failure(tx.query(update, [member, "écrivez à afiwa.h@gmail.com"])))).toMatch(/text_rejected/);
    expect(
      await asUser(db, member, async (tx) => (await tx.query(update, [member, "Calme, souriante et curieuse."])).affectedRows),
    ).toBe(1);

    // La décision de l'équipe ne touche pas au texte : pas de nouveau contrôle
    const text = (await db.query<{ id: string }>("select id from app.profile_texts where user_id = $1", [member])).rows[0]!;
    await asUser(db, moderator, (tx) => tx.query("select app.review_profile_text($1, 'approved', null)", [text.id]));
  });
});
