import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Module « Paiements » de l'administration (section 11.2-9), en lecture :
 * transactions, soirée concernée, remboursements. Permission payments.read.
 */

let db: PGlite;
let admin: string;
let moderator: string;
let member: string;
let event: string;
const payments: Record<string, string> = {};

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  moderator = await createMember(db, { firstName: "Sèna", sex: "male", role: "moderator" });
  member = await createMember(db, { firstName: "Mahougnon", sex: "female" });
  const other = await createMember(db, { firstName: "Comlan", sex: "male" });
  event = await createEvent(db, { startsInHours: 72 });

  const pay = async (name: string, userId: string, purpose: string, status: string, extra = "") => {
    const { rows } = await db.query<{ id: string }>(
      `insert into app.payments (user_id, purpose, amount_xof, provider, provider_transaction_id, status)
       values ($1, $2::app.payment_purpose, 5000, 'simulated', $3, $4::app.payment_status) returning id`,
      [userId, purpose, `sim_${name}`, status],
    );
    payments[name] = rows[0]!.id;
    if (extra) await db.query(extra, [rows[0]!.id]);
  };
  await pay("soiree", member, "evening_booking", "succeeded");
  await db.query(
    "insert into app.event_registrations (event_id, user_id, sex, status, seated_at, payment_id) values ($1, $2, 'female', 'confirmed', now(), $3)",
    [event, member, payments.soiree],
  );
  await pay("demande", other, "evening_booking", "succeeded", "update app.payments set refund_requested_at = now() where id = $1");
  await pay("rembourse", other, "evening_booking", "refunded", "update app.payments set refunded_amount_xof = amount_xof where id = $1");
  await pay("inscription", other, "registration_fee", "pending");
}, 120_000);

afterAll(async () => {
  await db?.close();
});

type Row = { payment_id: string; first_name: string | null; event_id: string | null; status: string; total: number };

const list = (userId: string, sql: string, params: unknown[] = []) =>
  asUser(db, userId, async (tx) => (await tx.query<Row>(sql, params)).rows);

describe("Paiements de l'administration (11.2-9)", () => {
  it("modérateur et membre : aucun accès", async () => {
    for (const user of [moderator, member]) {
      const error = await asUser(db, user, (tx) => failure(tx.query("select * from app.admin_payments()")));
      expect(error).toMatch(/forbidden/);
    }
  });

  it("transactions avec le membre et la soirée concernés, les plus récentes d'abord", async () => {
    const rows = await list(admin, "select * from app.admin_payments()");
    expect(rows.map((r) => r.payment_id)).toEqual([payments.inscription, payments.rembourse, payments.demande, payments.soiree]);
    const soiree = rows.find((r) => r.payment_id === payments.soiree)!;
    expect(soiree).toMatchObject({ first_name: "Mahougnon", event_id: event, status: "succeeded", total: 4 });
  });

  it("filtres : état, objet, remboursement demandé ou effectué, recherche, pagination", async () => {
    const ids = async (sql: string, params: unknown[] = []) => (await list(admin, sql, params)).map((r) => r.payment_id);
    expect(await ids("select * from app.admin_payments(null, 'pending')")).toEqual([payments.inscription]);
    expect(await ids("select * from app.admin_payments(null, null, 'registration_fee')")).toEqual([payments.inscription]);
    expect(await ids("select * from app.admin_payments(null, null, null, 'requested')")).toEqual([payments.demande]);
    expect(await ids("select * from app.admin_payments(null, null, null, 'refunded')")).toEqual([payments.rembourse]);
    expect(await ids("select * from app.admin_payments('mahou')")).toEqual([payments.soiree]);
    expect(await ids("select * from app.admin_payments('sim_demande')")).toEqual([payments.demande]);
    const page = await list(admin, "select * from app.admin_payments(null, null, null, null, 2, 2)");
    expect(page.map((r) => r.payment_id)).toEqual([payments.demande, payments.soiree]);
    expect(page[0]!.total).toBe(4);
    const error = await asUser(db, admin, (tx) => failure(tx.query("select * from app.admin_payments(null, null, null, 'autre')")));
    expect(error).toMatch(/invalid_filter/);
  });

  it("remboursement manuel FeexPay (22 octobre 2026) : marqué par l'équipe des paiements, une seule fois, journalisé", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into app.payments (user_id, purpose, amount_xof, provider, provider_transaction_id, status, refund_requested_at)
       values ($1, 'evening_booking', 10000, 'feexpay', 'ref-fx-1', 'succeeded', now()) returning id`,
      [member],
    );
    const id = rows[0]!.id;
    const mark = (user: string, payment: string) => asUser(db, user, (tx) => failure(tx.query("select app.admin_mark_refunded($1)", [payment])));
    expect(await mark(moderator, id)).toMatch(/forbidden/);
    expect(await mark(member, id)).toMatch(/forbidden/);
    expect(await mark(admin, payments.soiree!)).toMatch(/not_refundable/);
    // Chaque essai est annulé à la fin : marquage, relecture et second marquage dans la même transaction
    const result = await asUser(db, admin, async (tx) => {
      const first = await failure(tx.query("select app.admin_mark_refunded($1)", [id]));
      const payment = (await tx.query<{ status: string; refunded_amount_xof: number }>("select status, refunded_amount_xof from app.payments where id = $1", [id])).rows[0];
      await tx.exec("reset role");
      const audit = (await tx.query<{ actor_id: string }>("select actor_id from app.audit_log where action = 'payment.refunded_manually' and target_id = $1", [id])).rows;
      await tx.exec("set local role authenticated");
      const second = await failure(tx.query("select app.admin_mark_refunded($1)", [id]));
      return { first, payment, audit, second };
    });
    expect(result).toEqual({
      first: null,
      payment: { status: "refunded", refunded_amount_xof: 10000 },
      audit: [{ actor_id: admin }],
      second: expect.stringMatching(/not_refundable/),
    });
  });
});
