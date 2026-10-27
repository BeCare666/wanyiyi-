import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Espace conseiller (section 7 ; question 9) : couples suivis seulement pendant l'accès accordé,
 * conversation du couple, notes privées jamais visibles par les membres.
 */

let db: PGlite;
const p: Record<string, string> = {};
let event: string;

async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

/** Couple, sa conversation et l'accès accordé au conseiller (comme après app.admin_assign_counselor). */
async function couple(a: string, b: string, counselor: string, includeHistory = false) {
  const m = await one<{ id: string }>(
    "insert into app.matches (event_id, member_a, member_b, announced_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), 'discovery_open') returning id",
    [event, a, b],
  );
  const d = await one<{ id: string }>("insert into app.discoveries (match_id, ends_at, status) values ($1, now(), 'continued') returning id", [m.id]);
  const c = await one<{ id: string }>(
    "insert into app.couples (discovery_id, member_a, member_b, counselor_id) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), $4) returning id",
    [d.id, a, b, counselor],
  );
  const chat = await one<{ id: string }>("insert into app.conversations (kind, couple_id) values ('couple', $1) returning id", [c.id]);
  return { id: c.id, chat: chat.id, grant: () => db.query(
    "insert into app.counselor_access (couple_id, counselor_id, requested_by, status, accepted_at, granted_at, include_history, price_xof) values ($1, $2, $3, 'granted', now(), now(), $4, 0)",
    [c.id, counselor, a, includeHistory],
  ) };
}

type Row = { couple_id: string; a_first_name: string; b_first_name: string; unread: number };

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, role] of [
    ["afiwa", "female", "member"],
    ["koffi", "male", "member"],
    ["sena", "female", "member"],
    ["dossou", "male", "member"],
    ["conseillere", "female", "counselor"],
    ["autre", "male", "counselor"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, role });
  }
  await db.query("insert into app.counselors (user_id, display_name) values ($1, 'Mme Conseillère'), ($2, 'M. Autre')", [p.conseillere, p.autre]);
  event = await createEvent(db, { startsInHours: -48, status: "finished" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Couples suivis (7)", () => {
  it("seulement pendant l'accès accordé ; messages non lus depuis son arrivée", async () => {
    const c = await couple(p.afiwa!, p.koffi!, p.conseillere!);
    await as(p.afiwa!, "select app.send_message($1, 'Avant le conseiller')", [c.chat]);
    expect(await as(p.conseillere!, "select * from app.counselor_couples()")).toEqual([]);
    await c.grant();
    await db.query("update app.counselor_access set granted_at = now() + interval '1 second' where couple_id = $1", [c.id]);
    const rows = await as<Row>(p.conseillere!, "select * from app.counselor_couples()");
    expect(rows).toHaveLength(1);
    expect([rows[0]!.a_first_name, rows[0]!.b_first_name].sort()).toEqual(["afiwa", "koffi"]);
    expect(rows[0]!.unread).toBe(0);
    await db.query("insert into app.messages (conversation_id, sender_id, body) values ($1, $2, 'Bonjour madame')", [c.chat, p.koffi]);
    await db.query("update app.messages set created_at = now() + interval '2 seconds' where body = 'Bonjour madame'");
    expect((await as<Row>(p.conseillere!, "select * from app.counselor_couples()"))[0]!.unread).toBe(1);
    await as(p.conseillere!, "select app.mark_conversation_read($1)", [c.chat]);
    await db.query("update app.conversation_reads set read_at = now() + interval '3 seconds' where user_id = $1", [p.conseillere]);
    expect((await as<Row>(p.conseillere!, "select * from app.counselor_couples()"))[0]!.unread).toBe(0);
    // Un autre conseiller ne voit rien, ne marque rien
    expect(await as(p.autre!, "select * from app.counselor_couples()")).toEqual([]);
    expect(await failure(as(p.autre!, "select app.mark_conversation_read($1)", [c.chat]))).toMatch(/not_member/);
    // Retrait : le couple disparaît aussitôt
    await db.query("update app.counselor_access set status = 'revoked', revoked_at = now() where couple_id = $1", [c.id]);
    expect(await as(p.conseillere!, "select * from app.counselor_couples()")).toEqual([]);
  });
});

describe("Notes privées (7)", () => {
  it("écrites et lues par le conseiller seul, tant que son accès est en cours", async () => {
    const c = await couple(p.sena!, p.dossou!, p.conseillere!);
    expect(await failure(as(p.conseillere!, "select app.add_counselor_note($1, 'Trop tôt')", [c.id]))).toMatch(/not_counselor/);
    await c.grant();
    expect(await failure(as(p.conseillere!, "select app.add_counselor_note($1, 'Premier échange serein.')", [c.id]))).toBeNull();
    expect(await failure(as(p.conseillere!, "select app.add_counselor_note($1, '  ')", [c.id]))).toMatch(/invalid_body/);
    const notes = await as<{ body: string }>(p.conseillere!, "select * from app.counselor_couple_notes($1)", [c.id]);
    expect(notes.map((n) => n.body)).toEqual(["Premier échange serein."]);
    // Membres et autre conseiller : rien, ni par la fonction ni par la table
    expect(await as(p.sena!, "select * from app.counselor_couple_notes($1)", [c.id])).toEqual([]);
    expect(await as(p.sena!, "select * from app.counselor_notes")).toEqual([]);
    expect(await as(p.autre!, "select * from app.counselor_couple_notes($1)", [c.id])).toEqual([]);
    expect(await failure(as(p.sena!, "select app.add_counselor_note($1, 'x')", [c.id]))).toMatch(/not_counselor/);
    // Retrait de l'accès : notes plus lisibles
    await db.query("update app.counselor_access set status = 'revoked', revoked_at = now() where couple_id = $1", [c.id]);
    expect(await as(p.conseillere!, "select * from app.counselor_couple_notes($1)", [c.id])).toEqual([]);
  });
});
