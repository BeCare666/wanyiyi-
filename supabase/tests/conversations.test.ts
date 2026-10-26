import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Conversations (9.4 à 9.6) : découverte, couple, canal privé. Conseiller du couple (question 9,
 * réponses du 26 octobre 2026) : invitation par l'un des deux, message dans le chat, accord de
 * l'autre, attribution par l'administration, puis le conseiller lit et écrit dans le chat ;
 * historique si les deux l'ont accepté ; retrait immédiat ; blocage du couple par l'administration.
 */

let db: PGlite;
const p: Record<string, string> = {};
let discoveryChat: string;
let coupleChat: string;
let privateChat: string;
let couple: string;

async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

const send = (user: string, conversation: string, body: string) => failure(as(user, "select app.send_message($1, $2)", [conversation, body]));
/** Messages écrits (sans les messages système) lisibles par la personne. */
const read = async (user: string, conversation: string) =>
  (await as<{ body: string }>(user, "select body from app.messages where conversation_id = $1 and not is_system order by created_at", [conversation])).map(
    (r) => r.body,
  );
/** Messages système du chat (code et membre concerné) lisibles par la personne. */
const notices = async (user: string, conversation: string) =>
  (
    await as<{ body: string; sender_id: string | null }>(user, "select body, sender_id from app.messages where conversation_id = $1 and is_system order by created_at", [
      conversation,
    ])
  ).map((r) => [r.body, r.sender_id]);
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, role] of [
    ["afiwa", "female", "member"],
    ["koffi", "male", "member"],
    ["sena", "female", "member"],
    ["dossou", "male", "member"],
    ["conseillere", "female", "counselor"],
    ["admin", "female", "admin"],
    ["moderateur", "male", "moderator"],
    ["autre", "male", "counselor"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, role });
  }
  for (const c of [p.conseillere, p.autre]) {
    await db.query("insert into app.counselors (user_id, display_name) values ($1, 'Conseiller fictif')", [c]);
  }
  const event = await createEvent(db, { startsInHours: -48, status: "finished" });
  const pair = async (a: string, b: string, status: string) => {
    const m = await one<{ id: string }>(
      "insert into app.matches (event_id, member_a, member_b, announced_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), $4::app.match_status) returning id",
      [event, a, b, status],
    );
    return (await one<{ id: string }>("insert into app.discoveries (match_id, ends_at) values ($1, now() + interval '14 days') returning id", [m.id])).id;
  };
  const d1 = await pair(p.sena!, p.dossou!, "discovery_open");
  discoveryChat = (await one<{ id: string }>("insert into app.conversations (kind, discovery_id) values ('discovery', $1) returning id", [d1])).id;
  const d2 = await pair(p.afiwa!, p.koffi!, "discovery_open");
  couple = (
    await one<{ id: string }>(
      "insert into app.couples (discovery_id, member_a, member_b, last_activity_at) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now() - interval '10 days') returning id",
      [d2, p.afiwa, p.koffi],
    )
  ).id;
  coupleChat = (await one<{ id: string }>("insert into app.conversations (kind, couple_id) values ('couple', $1) returning id", [couple])).id;
  privateChat = (
    await one<{ id: string }>("insert into app.conversations (kind, member_id, counselor_id) values ('counselor_private', $1, $2) returning id", [p.afiwa, p.conseillere])
  ).id;
  // Message ancien du couple, avant toute demande d'accès
  await db.query("insert into app.messages (conversation_id, sender_id, body, created_at) values ($1, $2, 'Ancien message', now() - interval '2 days')", [coupleChat, p.afiwa]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Conversations (9.4 à 9.6)", () => {
  it("découverte : les deux membres écrivent et lisent ; personne d'autre", async () => {
    expect(await send(p.sena!, discoveryChat, "Bonsoir Dossou")).toBeNull();
    expect(await send(p.dossou!, discoveryChat, "  Bonsoir Sena  ")).toBeNull();
    expect(await read(p.dossou!, discoveryChat)).toEqual(["Bonsoir Dossou", "Bonsoir Sena"]);
    expect(await read(p.afiwa!, discoveryChat)).toEqual([]);
    expect(await read(p.conseillere!, discoveryChat)).toEqual([]);
    expect(await send(p.afiwa!, discoveryChat, "Intrusion")).toMatch(/not_member/);
    expect(await as(p.afiwa!, "select id from app.conversations where id = $1", [discoveryChat])).toEqual([]);
  });

  it("texte de 1 à 2 000 caractères ; conversation fermée ou en lecture seule : plus d'envoi", async () => {
    expect(await send(p.sena!, discoveryChat, "   ")).toMatch(/invalid_body/);
    expect(await send(p.sena!, discoveryChat, "x".repeat(2001))).toMatch(/invalid_body/);
    await db.query("update app.conversations set closed_at = now() where id = $1", [discoveryChat]);
    expect(await send(p.sena!, discoveryChat, "Encore là ?")).toMatch(/conversation_closed/);
    await db.query("update app.conversations set closed_at = null, read_only = true where id = $1", [discoveryChat]);
    expect(await send(p.sena!, discoveryChat, "Encore là ?")).toMatch(/conversation_closed/);
  });

  it("liens, e-mails et numéros bloqués dans le chat (question 8) ; pseudos permis", async () => {
    await db.query("update app.conversations set read_only = false where id = $1", [discoveryChat]);
    expect(await send(p.sena!, discoveryChat, "Appelle-moi au 97 12 34 56")).toMatch(/contact_blocked/);
    expect(await send(p.sena!, discoveryChat, "mon numéro : neuf sept douze trente-quatre cinquante-six")).toMatch(/contact_blocked/);
    expect(await send(p.sena!, discoveryChat, "Écris-moi à sena@exemple.bj")).toMatch(/contact_blocked/);
    expect(await send(p.sena!, discoveryChat, "Regarde www.exemple.bj")).toMatch(/contact_blocked/);
    expect(await send(p.koffi!, coupleChat, "Mon numéro : 0197123456")).toMatch(/contact_blocked/);
    expect(await send(p.sena!, discoveryChat, "Je suis sur Instagram @sena_bj")).toBeNull();
    expect(await send(p.sena!, discoveryChat, "Rendez-vous samedi à 15 h, table 4 ?")).toBeNull();
  });

  it("couple : un message compte comme activité", async () => {
    expect(await send(p.koffi!, coupleChat, "On se voit samedi ?")).toBeNull();
    const { last_activity_at } = await one<{ last_activity_at: Date }>("select last_activity_at from app.couples where id = $1", [couple]);
    expect(Date.now() - last_activity_at.getTime()).toBeLessThan(60_000);
  });

  let access: string;
  it("invitation par l'un des deux : message dans le chat pour l'autre ; le conseiller ne lit rien", async () => {
    const [{ id }] = await as<{ id: string }>(p.afiwa!, "select app.request_counselor_access($1, true) as id", [couple]);
    access = id;
    expect(await notices(p.koffi!, coupleChat)).toEqual([["counselor_access.requested", p.afiwa]]);
    expect(await read(p.conseillere!, coupleChat)).toEqual([]);
    expect(await failure(as(p.koffi!, "select app.request_counselor_access($1, false)", [couple]))).toMatch(/access_pending/);
    expect(await failure(as(p.afiwa!, "select app.answer_counselor_access($1, true, true)", [access]))).toMatch(/own_request/);
    expect(await failure(as(p.sena!, "select app.answer_counselor_access($1, true, true)", [access]))).toMatch(/not_member/);
  });

  it("acceptation de l'autre : en attente de l'attribution d'un conseiller par l'administration", async () => {
    const [{ s: status }] = await as<{ s: string }>(p.koffi!, "select app.answer_counselor_access($1, true, false) as s", [access]);
    expect(status).toBe("requested");
    expect((await notices(p.afiwa!, coupleChat)).at(-1)).toEqual(["counselor_access.accepted", p.koffi]);
    expect(await read(p.conseillere!, coupleChat)).toEqual([]);
    const pending = await as<{ access_id: string }>(p.admin!, "select * from app.admin_counselor_requests()");
    expect(pending.map((r) => r.access_id)).toEqual([access]);
    expect(await failure(as(p.moderateur!, "select * from app.admin_counselor_requests()"))).toMatch(/forbidden/);
    expect(await failure(as(p.afiwa!, "select app.admin_assign_counselor($1, $2)", [access, p.conseillere]))).toMatch(/forbidden/);
  });

  it("attribution par l'administration : le conseiller entre dans le chat, lit depuis son arrivée et écrit", async () => {
    await db.query("update app.counselors set is_available = false where user_id = $1", [p.autre]);
    expect(await failure(as(p.admin!, "select app.admin_assign_counselor($1, $2)", [access, p.autre]))).toMatch(/counselor_unavailable/);
    expect(await failure(as(p.admin!, "select app.admin_assign_counselor($1, $2)", [access, p.conseillere]))).toBeNull();
    expect((await notices(p.koffi!, coupleChat)).at(-1)).toEqual(["counselor_access.granted", null]);
    expect(await read(p.conseillere!, coupleChat)).toEqual([]);
    expect(await send(p.afiwa!, coupleChat, "Bonjour Madame")).toBeNull();
    expect(await send(p.conseillere!, coupleChat, "Bonjour à vous deux")).toBeNull();
    expect(await read(p.conseillere!, coupleChat)).toEqual(["Bonjour Madame", "Bonjour à vous deux"]);
    expect(await read(p.koffi!, coupleChat)).toContain("Bonjour à vous deux");
    expect(await read(p.autre!, coupleChat)).toEqual([]);
    expect(await send(p.autre!, coupleChat, "Intrusion")).toMatch(/not_member/);
    const [{ has }] = await as<{ has: boolean }>(p.koffi!, "select app.counselor_has_access($1) as has", [coupleChat]);
    expect(has).toBe(true);
  });

  it("retrait par l'un ou l'autre : effet immédiat, signalé dans le chat", async () => {
    expect(await failure(as(p.koffi!, "select app.revoke_counselor_access($1)", [access]))).toBeNull();
    expect(await read(p.conseillere!, coupleChat)).toEqual([]);
    expect(await send(p.conseillere!, coupleChat, "Encore là ?")).toMatch(/not_member/);
    expect((await notices(p.afiwa!, coupleChat)).at(-1)).toEqual(["counselor_access.revoked", p.koffi]);
    expect(await failure(as(p.koffi!, "select app.revoke_counselor_access($1)", [access]))).toMatch(/not_pending/);
  });

  it("historique seulement si les deux l'ont accepté", async () => {
    const [{ id }] = await as<{ id: string }>(p.koffi!, "select app.request_counselor_access($1, true) as id", [couple]);
    await as(p.afiwa!, "select app.answer_counselor_access($1, true, true)", [id]);
    await as(p.admin!, "select app.admin_assign_counselor($1, $2)", [id, p.conseillere]);
    expect((await read(p.conseillere!, coupleChat))[0]).toBe("Ancien message");
  });

  it("blocage par l'administration : chat en lecture seule, conseiller retiré, motif aux deux ; levée possible", async () => {
    expect(await failure(as(p.moderateur!, "select app.admin_block_couple($1, 'Motif')", [couple]))).toMatch(/forbidden/);
    expect(await failure(as(p.admin!, "select app.admin_block_couple($1, ' ')", [couple]))).toMatch(/reason_required/);
    expect(await failure(as(p.admin!, "select app.admin_block_couple($1, 'Signalement en cours')", [couple]))).toBeNull();
    expect(await send(p.afiwa!, coupleChat, "Allô ?")).toMatch(/conversation_closed/);
    expect(await read(p.conseillere!, coupleChat)).toEqual([]);
    expect(await read(p.afiwa!, coupleChat)).toContain("Bonjour Madame");
    const { rows } = await db.query<{ payload: { reason: string } }>(
      "select payload from app.notifications where kind = 'couple.blocked' and user_id in ($1, $2)",
      [p.afiwa, p.koffi],
    );
    expect(rows.map((r) => r.payload.reason)).toEqual(["Signalement en cours", "Signalement en cours"]);
    expect(await failure(as(p.afiwa!, "select app.request_counselor_access($1, false)", [couple]))).toMatch(/couple_blocked/);
    expect(await failure(as(p.admin!, "select app.admin_unblock_couple($1)", [couple]))).toBeNull();
    expect(await send(p.afiwa!, coupleChat, "Nous revoilà")).toBeNull();
    expect(await read(p.conseillere!, coupleChat)).toEqual([]);
    // Refus de l'autre : aucune attribution possible
    const [{ id }] = await as<{ id: string }>(p.afiwa!, "select app.request_counselor_access($1, false) as id", [couple]);
    const [{ s: status }] = await as<{ s: string }>(p.koffi!, "select app.answer_counselor_access($1, false, false) as s", [id]);
    expect(status).toBe("refused");
    expect(await failure(as(p.admin!, "select app.admin_assign_counselor($1, $2)", [id, p.conseillere]))).toMatch(/not_pending/);
  });

  it("canal privé : le membre et son conseiller seulement ; il ne donne aucun accès au couple", async () => {
    expect(await send(p.afiwa!, privateChat, "Puis-je vous parler seule ?")).toBeNull();
    expect(await send(p.conseillere!, privateChat, "Bien sûr.")).toBeNull();
    expect(await read(p.conseillere!, privateChat)).toEqual(["Puis-je vous parler seule ?", "Bien sûr."]);
    expect(await read(p.koffi!, privateChat)).toEqual([]);
    expect(await read(p.autre!, privateChat)).toEqual([]);
    expect(await read(p.conseillere!, coupleChat)).toEqual([]);
  });

  it("aucune écriture directe ; journal des accès", async () => {
    expect(await failure(as(p.afiwa!, "insert into app.messages (conversation_id, sender_id, body) values ($1, $2, 'direct')", [coupleChat, p.afiwa]))).toMatch(
      /row-level security|permission denied/,
    );
    expect(await failure(as(p.afiwa!, "update app.counselor_access set status = 'granted'"))).toBeNull();
    const { rows } = await db.query<{ status: string }>("select status from app.counselor_access where couple_id = $1 order by created_at", [couple]);
    expect(rows.map((r) => r.status)).toEqual(["revoked", "revoked", "refused"]);
    const { rows: audit } = await db.query("select action from app.audit_log where action like 'counselor_access.%'");
    expect(audit.length).toBeGreaterThanOrEqual(7);
  });
});
