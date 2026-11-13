import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Menu « Discussions » (demande du 13/11/2026) : liste façon WhatsApp des matchs en cours, de la
 * discussion du couple et du conseiller sollicité seul ; découvertes terminées relisibles en
 * lecture seule jusqu'à leur effacement (90 jours), à la place de la règle Q14 (invisibles).
 */

let db: PGlite;
const p: Record<string, string> = {};
let activeChat: string;
let endedChat: string;
let endedDiscovery: string;
let purgedChat: string;
let coupleChat: string;
let counselChat: string;

async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
const send = (user: string, conversation: string, body: string) => failure(as(user, "select app.send_message($1, $2)", [conversation, body]));
const read = async (user: string, conversation: string) =>
  (await as<{ body: string }>(user, "select body from app.messages where conversation_id = $1 and not is_system order by created_at", [conversation])).map((r) => r.body);

type Row = { kind: string; conversation_id: string; target_id: string; title: string; last_body: string | null; unread: number; read_only: boolean };
const list = (user: string) => as<Row>(user, "select * from app.my_conversations()");

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, role] of [
    ["Afiavi", "female", "member"],
    ["Koffi", "male", "member"],
    ["Sèna", "male", "member"],
    ["Codjo", "male", "member"],
    ["Ayaba", "female", "member"],
    ["Rachidatou", "female", "admin"],
    ["Conseillère", "female", "counselor"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, role });
  }
  await db.query("insert into app.counselors (user_id, display_name) values ($1, 'Mme Conseillère')", [p["Conseillère"]]);
  const event = await createEvent(db, { startsInHours: -48, status: "finished" });
  const pair = async (a: string, b: string) => {
    const m = await one<{ id: string }>(
      "insert into app.matches (event_id, member_a, member_b, announced_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), 'discovery_open') returning id",
      [event, a, b],
    );
    const d = (await one<{ id: string }>("insert into app.discoveries (match_id, ends_at) values ($1, now() + interval '14 days') returning id", [m.id])).id;
    const c = (await one<{ id: string }>("insert into app.conversations (kind, discovery_id) values ('discovery', $1) returning id", [d])).id;
    return { d, c };
  };
  // Afiavi : un match en cours avec Koffi, un match terminé avec Sèna, un autre terminé et déjà effacé avec Codjo
  activeChat = (await pair(p.Afiavi!, p.Koffi!)).c;
  const ended = await pair(p.Afiavi!, p["Sèna"]!);
  endedChat = ended.c;
  endedDiscovery = ended.d;
  purgedChat = (await pair(p.Afiavi!, p.Codjo!)).c;
  for (const chat of [activeChat, endedChat, purgedChat]) {
    expect(await send(p.Afiavi!, chat, "Bonsoir, ravie de vous avoir rencontré")).toBeNull();
  }
  expect(await send(p["Sèna"]!, endedChat, "Bonsoir Afiavi")).toBeNull();
  // Fin des deux découvertes (le déclencheur rend la discussion en lecture seule, effacée dans 90 jours)
  await db.query("update app.discoveries set status = 'expired', closed_at = now() where id = $1", [ended.d]);
  const purged = await one<{ discovery_id: string }>("select discovery_id from app.conversations where id = $1", [purgedChat]);
  await db.query("update app.discoveries set status = 'closed', closed_at = now() where id = $1", [purged.discovery_id]);
  await db.query("update app.conversations set delete_after = now() - interval '1 minute' where id = $1", [purgedChat]);

  // Ayaba est en couple avec Codjo
  const coupleDiscovery = await pair(p.Ayaba!, p.Codjo!);
  const couple = (
    await one<{ id: string }>(
      "insert into app.couples (discovery_id, member_a, member_b, last_activity_at) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now()) returning id",
      [coupleDiscovery.d, p.Ayaba, p.Codjo],
    )
  ).id;
  coupleChat = (await one<{ id: string }>("insert into app.conversations (kind, couple_id) values ('couple', $1) returning id", [couple])).id;
  expect(await send(p.Codjo!, coupleChat, "Bonjour mon cœur")).toBeNull();

  // Afiavi sollicite un conseiller seule
  const [{ id: request }] = await as<{ id: string }>(p.Afiavi!, "select app.request_counsel() as id");
  counselChat = (await as<{ id: string }>(p.Rachidatou!, "select app.admin_assign_counsel($1, $2) as id", [request, p["Conseillère"]]))[0]!.id;
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("Liste des discussions", () => {
  it("rassemble match en cours, conseiller seul et découverte terminée (lecture seule) ; l'effacée n'apparaît plus", async () => {
    const rows = await list(p.Afiavi!);
    const byChat = new Map(rows.map((r) => [r.conversation_id, r]));
    expect(byChat.get(activeChat)).toMatchObject({ kind: "discovery", title: "Koffi", read_only: false });
    expect(byChat.get(counselChat)).toMatchObject({ kind: "counsel", title: "Mme Conseillère", read_only: false });
    expect(byChat.get(endedChat)).toMatchObject({ kind: "discovery_ended", title: "Sèna", target_id: endedDiscovery, read_only: true, unread: 0 });
    expect(byChat.has(purgedChat)).toBe(false);
    // Les discussions terminées viennent après les discussions en cours
    expect(rows[rows.length - 1]!.kind).toBe("discovery_ended");
  });

  it("dernier message et messages non lus", async () => {
    const [mine] = (await list(p["Sèna"]!)).filter((r) => r.conversation_id === endedChat);
    expect(mine).toMatchObject({ kind: "discovery_ended", title: "Afiavi", last_body: "Bonsoir Afiavi" });
    const couple = (await list(p.Ayaba!)).find((r) => r.conversation_id === coupleChat);
    expect(couple).toMatchObject({ kind: "couple", title: "Codjo", last_body: "Bonjour mon cœur", unread: 1 });
  });

  it("personne d'autre ne voit ces discussions", async () => {
    const rows = await list(p.Koffi!);
    expect(rows.map((r) => r.conversation_id)).toEqual([activeChat]);
  });
});

describe("Découverte terminée en lecture seule", () => {
  it("les deux membres relisent les messages, mais ne peuvent plus écrire", async () => {
    expect(await read(p.Afiavi!, endedChat)).toEqual(["Bonsoir, ravie de vous avoir rencontré", "Bonsoir Afiavi"]);
    expect(await read(p["Sèna"]!, endedChat)).toHaveLength(2);
    expect(await send(p.Afiavi!, endedChat, "Encore un mot")).toMatch(/conversation_closed|not_member/);
  });

  it("un tiers ne lit rien ; une discussion effacée ne se relit plus", async () => {
    expect(await read(p.Koffi!, endedChat)).toEqual([]);
    expect(await as(p.Koffi!, "select id from app.conversations where id = $1", [endedChat])).toEqual([]);
    expect(await as(p.Afiavi!, "select id from app.conversations where id = $1", [purgedChat])).toEqual([]);
  });

  it("le reste des droits du membre n'est pas élargi (conversation_member inchangée)", async () => {
    // Fonction interne (non accordée aux membres) : appelée comme le ferait une autre fonction de la base
    const member = await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: p.Afiavi, role: "authenticated" })]);
      return (await tx.query<{ member: boolean }>("select app.conversation_member($1) as member", [endedChat])).rows[0]!.member;
    });
    expect(member).toBe(false);
  });
});
