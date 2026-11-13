import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createMember } from "./fixtures";

/**
 * Demande du 10/11/2026 : un membre sollicite un conseiller seul (sans accord de personne),
 * l'administration l'attribue, 3 messages gratuits une seule fois, puis 200 FCFA par message
 * du membre (réponses du conseiller gratuites), réglables dans l'administration.
 */

let db: PGlite;
let admin: string;
let member: string;
let counselor: string;

async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
const send = (user: string, conversation: string, body: string) => as<{ id: string }>(user, "select app.send_message($1, $2) as id", [conversation, body]);

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  member = await createMember(db, { firstName: "Koffi", sex: "male" });
  counselor = await createMember(db, { firstName: "Conseillère", sex: "female", role: "counselor" });
  await db.query("insert into app.counselors (user_id, display_name) values ($1, 'Mme Conseillère')", [counselor]);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("Demande seule", () => {
  let request: string;
  let conversation: string;

  it("un membre non vérifié ne peut pas demander", async () => {
    const pending = await createMember(db, { firstName: "Awa", sex: "female", status: "pending_verification" });
    expect(await failure(as(pending, "select app.request_counsel()"))).toMatch(/not_validated/);
  });

  it("un membre vérifié, sans couple, demande seul ; une seule demande en cours", async () => {
    const [{ id }] = await as<{ id: string }>(member, "select app.request_counsel() as id");
    request = id;
    expect(await failure(as(member, "select app.request_counsel()"))).toMatch(/already_requested/);
    const [mine] = await as<{ status: string; conversation_id: string | null; free_left: number; price_xof: number }>(member, "select * from app.my_counsel()");
    expect(mine).toMatchObject({ status: "requested", conversation_id: null, free_left: 3, price_xof: 200 });
  });

  it("l'administration voit la demande et attribue le conseiller ; un membre ne peut pas attribuer", async () => {
    const rows = await as<{ request_id: string; first_name: string }>(admin, "select * from app.admin_counsel_requests()");
    expect(rows.map((r) => r.request_id)).toContain(request);
    expect(await failure(as(member, "select app.admin_assign_counsel($1, $2)", [request, counselor]))).toMatch(/forbidden/);
    const [{ id }] = await as<{ id: string }>(admin, "select app.admin_assign_counsel($1, $2) as id", [request, counselor]);
    conversation = id;
    const notes = await db.query<{ user_id: string; kind: string }>("select user_id, kind from app.notifications where kind like 'counsel.%'");
    expect(notes.rows).toEqual(expect.arrayContaining([{ user_id: member, kind: "counsel.assigned" }, { user_id: counselor, kind: "counsel.granted" }]));
    const [mine] = await as<{ status: string; conversation_id: string; counselor_name: string }>(member, "select * from app.my_counsel()");
    expect(mine).toMatchObject({ status: "granted", conversation_id: conversation, counselor_name: "Mme Conseillère" });
  });

  it("le conseiller voit la discussion parmi ses canaux privés, marquée comme demande seule", async () => {
    const rows = await as<{ conversation_id: string; counsel_request_id: string; member_first_name: string }>(counselor, "select * from app.counselor_private_channels()");
    expect(rows).toEqual([expect.objectContaining({ conversation_id: conversation, counsel_request_id: request, member_first_name: "Koffi" })]);
  });

  it("3 messages gratuits, puis paiement demandé ; les réponses du conseiller restent gratuites", async () => {
    for (const body of ["Bonjour", "J'ai une question", "Merci"]) expect(await failure(send(member, conversation, body))).toBeNull();
    expect(await failure(send(member, conversation, "Encore une"))).toMatch(/payment_required/);
    expect(await failure(send(counselor, conversation, "Je vous écoute"))).toBeNull();
    expect(await failure(send(counselor, conversation, "Écrivez-moi"))).toBeNull();
    const [mine] = await as<{ free_left: number }>(member, "select free_left from app.my_counsel()");
    expect(mine!.free_left).toBe(0);
  });

  it("message payant : préparé à 200 FCFA, remis dans la discussion quand le paiement réussit", async () => {
    const [prepared] = await as<{ pending_id: string; price_xof: number }>(member, "select * from app.prepare_counsel_message($1, $2)", [conversation, "Message payé"]);
    expect(prepared!.price_xof).toBe(200);
    const payment = await one<{ id: string }>(
      "insert into app.payments (user_id, purpose, amount_xof, provider) values ($1, 'counsel_message', 200, 'simulated') returning id",
      [member],
    );
    await db.query("update app.counsel_pending_messages set payment_id = $2 where id = $1", [prepared!.pending_id, payment.id]);
    expect((await db.query("select 1 from app.messages where body = 'Message payé'")).rows).toHaveLength(0);
    await db.query("update app.payments set status = 'succeeded' where id = $1", [payment.id]);
    const delivered = await one<{ sender_id: string; payment_id: string }>("select sender_id, payment_id from app.messages where body = 'Message payé'");
    expect(delivered).toEqual({ sender_id: member, payment_id: payment.id });
    // Deuxième passage du statut : pas de doublon
    await db.query("update app.payments set status = 'pending' where id = $1", [payment.id]);
    await db.query("update app.payments set status = 'succeeded' where id = $1", [payment.id]);
    expect((await db.query("select 1 from app.messages where body = 'Message payé'")).rows).toHaveLength(1);
  });

  it("préparation refusée pour un autre membre, un lien ou quand il reste des messages gratuits", async () => {
    const other = await createMember(db, { firstName: "Sena", sex: "female" });
    expect(await failure(as(other, "select * from app.prepare_counsel_message($1, 'x')", [conversation]))).toMatch(/not_member/);
    expect(await failure(as(member, "select * from app.prepare_counsel_message($1, 'voir https://exemple.com')", [conversation]))).toMatch(/contact_blocked/);
    const [{ id }] = await as<{ id: string }>(other, "select app.request_counsel() as id");
    const [{ id: conv }] = await as<{ id: string }>(admin, "select app.admin_assign_counsel($1, $2) as id", [id, counselor]);
    expect(await failure(as(other, "select * from app.prepare_counsel_message($1, 'Bonjour')", [conv]))).toMatch(/nothing_to_pay/);
    expect(await failure(as(member, "select app.send_message($1, 'intrus')", [conv]))).toMatch(/not_member/);
  });

  it("réglage par l'administration : 0 FCFA rend tout gratuit, plus de messages gratuits en rend de nouveau", async () => {
    expect(await failure(as(member, "select app.admin_set_counsel_pricing(0, 3)"))).toMatch(/forbidden/);
    expect(await failure(as(admin, "select app.admin_set_counsel_pricing(-1, 3)"))).toMatch(/invalid_price/);
    await as(admin, "select app.admin_set_counsel_pricing(0, 3)");
    expect(await failure(send(member, conversation, "Gratuit maintenant"))).toBeNull();
    await as(admin, "select app.admin_set_counsel_pricing(200, 5)");
    const [mine] = await as<{ free_left: number }>(member, "select free_left from app.my_counsel()");
    expect(mine!.free_left).toBe(2);
    await as(admin, "select app.admin_set_counsel_pricing(200, 3)");
  });

  it("fin de la discussion par le membre : fermée, conseiller prévenu, nouvelle demande possible", async () => {
    expect(await failure(as(admin, "select app.close_counsel($1)", [request]))).toMatch(/not_found/);
    await as(member, "select app.close_counsel($1)", [request]);
    const conv = await one<{ closed: boolean; read_only: boolean; has_delete: boolean }>(
      "select closed_at is not null as closed, read_only, delete_after is not null as has_delete from app.conversations where id = $1",
      [conversation],
    );
    expect(conv).toEqual({ closed: true, read_only: true, has_delete: true });
    expect(await failure(send(counselor, conversation, "Encore là ?"))).toMatch(/not_member|conversation_closed/);
    expect((await db.query("select 1 from app.notifications where user_id = $1 and kind = 'counsel.closed'", [counselor])).rows).toHaveLength(1);
    const [{ id }] = await as<{ id: string }>(member, "select app.request_counsel() as id");
    // Les messages gratuits ne reviennent pas avec une nouvelle demande
    const [mine] = await as<{ free_left: number }>(member, "select free_left from app.my_counsel()");
    expect(mine!.free_left).toBe(0);
    await as(member, "select app.cancel_counsel_request($1)", [id]);
    expect(await as(member, "select * from app.my_counsel()")).toHaveLength(0);
  });

  it("la demande à deux du couple reste gratuite dans le canal privé du couple (inchangée)", async () => {
    const row = await one<{ n: number }>("select count(*)::int as n from pg_proc where proname in ('request_counselor_access', 'answer_counselor_access', 'open_private_channel')");
    expect(row.n).toBe(3);
  });
});
