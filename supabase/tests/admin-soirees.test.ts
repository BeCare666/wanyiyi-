import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createEvent, createMember, createVenue, register } from "./fixtures";

/**
 * Module « Soirées » de l'administration (section 11.2-5) : brouillon, publication,
 * inscriptions et liste d'attente, résultats ; aucune écriture directe sur les soirées.
 */

let db: PGlite;
let admin: string;
let moderator: string;
let member: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  moderator = await createMember(db, { firstName: "Sèna", sex: "male", role: "moderator" });
  member = await createMember(db, { firstName: "Afiwa", sex: "female" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const rows = async <T>(p: Promise<{ rows: T[] }>) => (await p).rows;

/** Une tentative qui doit échouer, sans casser la transaction du test. */
async function attempt(tx: Transaction, sql: string, params: unknown[] = []) {
  await tx.exec("savepoint essai");
  const error = await failure(tx.query(sql, params));
  await tx.exec(error ? "rollback to savepoint essai" : "release savepoint essai");
  return error;
}

type Draft = { event?: string | null; venue?: string | null; startsInHours?: number; women?: number; men?: number; round?: number; change?: number; price?: number | null };

const save = (tx: Transaction, d: Draft = {}) =>
  tx.query<{ id: string }>(
    `select app.save_event($1, $2, null, now() + make_interval(secs => $3::float8 * 3600), $4::smallint, $5::smallint, $6::smallint, $7::smallint, $8) as id`,
    [d.event ?? null, d.venue ?? null, d.startsInHours ?? 240, d.women ?? 10, d.men ?? 10, d.round ?? 7, d.change ?? 1, d.price ?? null],
  );

const SAVE_SQL = `select app.save_event($1, $2, null, now() + make_interval(secs => $3::float8 * 3600), $4::smallint, $5::smallint, $6::smallint, $7::smallint, $8)`;
const saveParams = (d: Draft) => [d.event ?? null, d.venue ?? null, d.startsInHours ?? 240, d.women ?? 10, d.men ?? 10, d.round ?? 7, d.change ?? 1, d.price ?? null];

describe("Brouillon et publication", () => {
  it("brouillon invisible des membres ; publication avec lieu et début futur ; modifiable ensuite (19 octobre) ; journalisé", async () => {
    const venue = await createVenue(db);
    const result = await asUser(db, admin, async (tx) => {
      const [created] = await rows(save(tx));
      const id = created!.id;
      const noVenue = await attempt(tx, "select app.publish_event($1)", [id]);
      await save(tx, { event: id, venue, women: 12, men: 11, price: 5000 });
      const [draft] = await rows(tx.query("select status, capacity_women, capacity_men, price_xof from app.events where id = $1", [id]));

      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: member, role: "authenticated" })]);
      const seenByMember = (await rows(tx.query("select id from app.events where id = $1", [id]))).length;
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin, role: "authenticated" })]);

      await tx.query("select app.publish_event($1)", [id]);
      const editAfter = await attempt(tx, SAVE_SQL, saveParams({ event: id, venue }));
      const publishAgain = await attempt(tx, "select app.publish_event($1)", [id]);
      const deletePublished = await attempt(tx, "select app.delete_draft_event($1)", [id]);
      // Le journal n'est lisible que par la super administration : contrôle en accès base
      await tx.exec("reset role");
      const audit = await rows(tx.query<{ action: string }>("select action from app.audit_log where target_id = $1 order by id", [id]));
      return { noVenue, draft, seenByMember, editAfter, publishAgain, deletePublished, audit: audit.map((a) => a.action) };
    });
    expect(result.noVenue).toMatch(/venue_required/);
    expect(result.draft).toEqual({ status: "draft", capacity_women: 12, capacity_men: 11, price_xof: 5000 });
    expect(result.seenByMember).toBe(0);
    expect(result.editAfter).toBeNull();
    expect(result.publishAgain).toMatch(/not_draft/);
    expect(result.deletePublished).toMatch(/not_draft/);
    expect(result.audit).toEqual(["event.created", "event.updated", "event.published", "event.updated"]);
  });

  it("refuse les valeurs hors règles : passé, capacité au-delà de 12, durées, tarif négatif", async () => {
    const drafts: Draft[] = [{ startsInHours: -1 }, { women: 13 }, { men: 0 }, { round: 0 }, { change: -1 }, { price: -5 }];
    const errors = await asUser(db, admin, async (tx) => {
      const out: (string | null)[] = [];
      // Une tentative après l'autre : les points de sauvegarde ne se croisent pas
      for (const d of drafts) out.push(await attempt(tx, SAVE_SQL, saveParams(d)));
      return out;
    });
    expect(errors).toEqual([
      expect.stringMatching(/starts_in_past/),
      expect.stringMatching(/invalid_capacity/),
      expect.stringMatching(/invalid_capacity/),
      expect.stringMatching(/invalid_duration/),
      expect.stringMatching(/invalid_duration/),
      expect.stringMatching(/invalid_price/),
    ]);
  });

  it("un brouillon se supprime ; sans le tarif, la soirée reste publiable", async () => {
    const venue = await createVenue(db);
    const result = await asUser(db, admin, async (tx) => {
      const [a] = await rows(save(tx, { venue }));
      const [b] = await rows(save(tx, { venue }));
      await tx.query("select app.delete_draft_event($1)", [a!.id]);
      await tx.query("select app.publish_event($1)", [b!.id]);
      const left = await rows(tx.query<{ id: string; status: string }>("select id, status from app.events where id in ($1, $2)", [a!.id, b!.id]));
      return left;
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("published");
  });
});

describe("Droits", () => {
  it("modérateur et membre : aucune fonction de gestion ; écritures directes sur les soirées sans effet", async () => {
    const event = await createEvent(db, { startsInHours: 120, status: "draft" });
    const check = (user: string) =>
      asUser(db, user, async (tx) => ({
        save: await attempt(tx, SAVE_SQL, saveParams({})),
        publish: await attempt(tx, "select app.publish_event($1)", [event]),
        remove: await attempt(tx, "select app.delete_draft_event($1)", [event]),
        list: await attempt(tx, "select * from app.admin_events()"),
        participants: await attempt(tx, "select * from app.event_participants($1)", [event]),
        results: await attempt(tx, "select * from app.event_results($1)", [event]),
        matches: await attempt(tx, "select * from app.event_matches($1)", [event]),
      }));
    for (const user of [moderator, member]) {
      for (const [what, error] of Object.entries(await check(user))) expect(error, what).toMatch(/forbidden/);
    }

    // L'administration elle-même ne contourne plus les fonctions
    const direct = await asUser(db, admin, async (tx) => ({
      update: (await tx.query("update app.events set status = 'finished' where id = $1 returning id", [event])).rows.length,
      insert: await attempt(tx, "insert into app.events (starts_at, status) values (now() + interval '1 day', 'published')"),
      round: await attempt(tx, "insert into app.rounds (event_id, round_number) values ($1, 1)", [event]),
    }));
    expect(direct.update).toBe(0);
    expect(direct.insert).toMatch(/row-level security/);
    expect(direct.round).toMatch(/row-level security/);
  });
});

describe("Inscriptions, liste d'attente et résultats", () => {
  it("remplissage par sexe, liste d'attente classée, pointage visible", async () => {
    const event = await createEvent(db, { startsInHours: 120, capacityWomen: 1, capacityMen: 2 });
    const w1 = await createMember(db, { firstName: "Mahougnon", sex: "female" });
    const w2 = await createMember(db, { firstName: "Houéfa", sex: "female" });
    const w3 = await createMember(db, { firstName: "Sênami", sex: "female" });
    const m1 = await createMember(db, { firstName: "Comlan", sex: "male" });
    await register(db, event, w1, "female", "confirmed");
    await register(db, event, m1, "male", "booked");
    // Liste d'attente : Sênami avant Houéfa (positions non consécutives, rang recalculé)
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'female', 4), ($1, $3, 'female', 9)", [event, w3, w2]);

    const result = await asUser(db, admin, async (tx) => ({
      list: (await rows(tx.query<Record<string, unknown>>("select * from app.admin_events() where id = $1", [event])))[0],
      participants: await rows(
        tx.query<{ first_name: string; status: string; waitlist_position: number | null }>(
          "select first_name, status, waitlist_position from app.event_participants($1)", [event]),
      ),
    }));
    expect(result.list).toMatchObject({ capacity_women: 1, capacity_men: 2, taken_women: 1, taken_men: 1, waiting_women: 2, waiting_men: 0, matches: 0 });
    expect(result.participants).toEqual([
      { first_name: "Mahougnon", status: "confirmed", waitlist_position: null },
      { first_name: "Sênami", status: "waitlisted", waitlist_position: 1 },
      { first_name: "Houéfa", status: "waitlisted", waitlist_position: 2 },
      { first_name: "Comlan", status: "booked", waitlist_position: null },
    ]);
  });

  it("résultats après la soirée : présents, votants, matchs, heure d'annonce", async () => {
    const event = await createEvent(db, { startsInHours: -1, capacityWomen: 2, capacityMen: 2 });
    const [w1, w2] = [await createMember(db, { firstName: "Ayaba", sex: "female" }), await createMember(db, { firstName: "Nafi", sex: "female" })];
    const [m1, m2] = [await createMember(db, { firstName: "Codjo", sex: "male" }), await createMember(db, { firstName: "Kpodé", sex: "male" })];
    for (const w of [w1, w2]) await register(db, event, w!, "female", "checked_in");
    for (const m of [m1, m2]) await register(db, event, m!, "male", "checked_in");

    const result = await asUser(db, admin, async (tx) => {
      await tx.query("select app.prepare_evening($1)", [event]);
      await tx.query("select app.start_evening($1)", [event]);
      const [{ qr }] = (await rows(tx.query<{ qr: string }>("select qr_token as qr from app.event_tables where event_id = $1 and table_number = 1", [event]))) as [{ qr: string }];
      const vote = async (user: string, choice: string) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
        await tx.query("select app.cast_vote($1, 1::smallint, $2::app.vote_choice, null, null, null)", [qr, choice]);
      };
      // Tour 1 : tout le monde dit oui à la personne rencontrée, donc deux matchs
      for (const user of [w1!, w2!, m1!, m2!]) await vote(user, "yes");
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin, role: "authenticated" })]);
      await tx.query("select app.finish_evening($1)", [event]);
      await tx.query("select app.compute_matches($1)", [event]);
      const [results] = await rows(tx.query<Record<string, unknown>>("select checked_in, voters, matches, results_computed_at is not null as computed from app.event_results($1)", [event]));
      const matches = await rows(tx.query<{ member_a_first_name: string; member_b_first_name: string }>("select member_a_first_name, member_b_first_name from app.event_matches($1)", [event]));
      const tables = (await rows(tx.query("select qr_token from app.event_tables where event_id = $1", [event]))).length;
      return { results, matches: matches.map((m) => [m.member_a_first_name, m.member_b_first_name].sort()), tables };
    });
    expect(result.results).toEqual({ checked_in: 4, voters: 4, matches: 2, computed: true });
    // Chaque match réunit une femme et un homme
    for (const pair of result.matches) {
      expect(pair.filter((name) => ["Ayaba", "Nafi"].includes(name))).toHaveLength(1);
    }
    expect(result.tables).toBe(2);
  });
});

describe("Soirée publiée : modification et annulation (décisions du 19 octobre 2026)", () => {
  it("modification notifiée aux inscrits et à la liste d'attente ; liste d'attente promue ; lieu obligatoire", async () => {
    const event = await createEvent(db, { startsInHours: 120, capacityWomen: 1, capacityMen: 2 });
    const venue = await createVenue(db);
    const w1 = await createMember(db, { firstName: "Adjoua", sex: "female" });
    const w2 = await createMember(db, { firstName: "Bénédicta", sex: "female" });
    const m1 = await createMember(db, { firstName: "Dossou", sex: "male" });
    await register(db, event, w1, "female", "confirmed");
    await register(db, event, m1, "male", "booked");
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'female', 1)", [event, w2]);

    const result = await asUser(db, admin, async (tx) => {
      const noVenue = await attempt(tx, SAVE_SQL, saveParams({ event, venue: null, women: 2, men: 2 }));
      await tx.query(SAVE_SQL, saveParams({ event, venue, women: 2, men: 2 }));
      await tx.exec("reset role");
      const notified = await rows(
        tx.query<{ user_id: string; kind: string }>("select user_id, kind from app.notifications where payload->>'event_id' = $1 order by kind", [event]),
      );
      const promoted = await rows(tx.query<{ status: string }>("select status from app.event_registrations where event_id = $1 and user_id = $2", [event, w2]));
      return { noVenue, notified, promoted: promoted[0]?.status };
    });
    expect(result.noVenue).toMatch(/venue_required/);
    expect(result.promoted).toBe("booked");
    const updated = result.notified.filter((n) => n.kind === "evening.updated").map((n) => n.user_id).sort();
    expect(updated).toEqual([w1, w2, m1].sort());
    expect(result.notified.some((n) => n.kind === "evening.seat_offered" && n.user_id === w2)).toBe(true);
  });

  it("places sous les places déjà prises refusées", async () => {
    const event = await createEvent(db, { startsInHours: 120, capacityWomen: 3 });
    const venue = await createVenue(db);
    for (const name of ["Ablawa", "Edwige"]) await register(db, event, await createMember(db, { firstName: name, sex: "female" }), "female", "booked");
    const error = await asUser(db, admin, (tx) => attempt(tx, SAVE_SQL, saveParams({ event, venue, women: 1 })));
    expect(error).toMatch(/capacity_below_taken/);
  });

  it("annulation : places annulées, liste d'attente vidée, notifications ; paiements reçus remboursés en entier, en attente annulés", async () => {
    const event = await createEvent(db, { startsInHours: 120 });
    const paid = await createMember(db, { firstName: "Fifamè", sex: "female" });
    const unpaid = await createMember(db, { firstName: "Gisèle", sex: "female" });
    const waiting = await createMember(db, { firstName: "Hounkpè", sex: "male" });
    await register(db, event, paid, "female", "confirmed");
    await register(db, event, unpaid, "female", "booked");
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'male', 1)", [event, waiting]);
    const pay = async (user: string, status: string) => {
      const inserted = await rows(
        db.query<{ id: string }>(
          "insert into app.payments (user_id, purpose, amount_xof, provider, status) values ($1, 'evening_booking', 5000, 'simulated', $2) returning id",
          [user, status],
        ),
      );
      const id = inserted[0]!.id;
      await db.query("update app.event_registrations set payment_id = $1 where event_id = $2 and user_id = $3", [id, event, user]);
      return id;
    };
    const paidPayment = await pay(paid, "succeeded");
    const pendingPayment = await pay(unpaid, "pending");

    const result = await asUser(db, admin, async (tx) => {
      const [cancelled] = await rows(tx.query<{ refunds: number }>("select app.cancel_event($1) as refunds", [event]));
      const again = await attempt(tx, "select app.cancel_event($1)", [event]);
      const forbiddenRefunds = await attempt(tx, "select * from app.pending_refunds()");
      await tx.exec("reset role");
      await tx.exec("set local role service_role");
      const pending = await rows(tx.query<{ payment_id: string; amount_xof: number }>("select payment_id, amount_xof from app.pending_refunds()"));
      await tx.query("select app.mark_refunded($1)", [paidPayment]);
      const twice = await attempt(tx, "select app.mark_refunded($1)", [paidPayment]);
      await tx.exec("reset role");
      const payments = await rows(
        tx.query<{ id: string; status: string; refunded_amount_xof: number }>(
          "select id, status, refunded_amount_xof from app.payments where id in ($1, $2) order by status",
          [paidPayment, pendingPayment],
        ),
      );
      const regs = await rows(tx.query<{ status: string }>("select distinct status from app.event_registrations where event_id = $1", [event]));
      const waitlist = (await rows(tx.query("select 1 from app.waitlist_entries where event_id = $1", [event]))).length;
      const notified = (
        await rows(tx.query<{ user_id: string }>("select user_id from app.notifications where kind = 'evening.cancelled' and payload->>'event_id' = $1", [event]))
      )
        .map((n) => n.user_id)
        .sort();
      const [status] = await rows(tx.query<{ status: string }>("select status from app.events where id = $1", [event]));
      return { refunds: cancelled?.refunds, again, forbiddenRefunds, pending, twice, payments, regs, waitlist, notified, status: status?.status };
    });
    expect(result.refunds).toBe(1);
    expect(result.again).toMatch(/invalid_status/);
    expect(result.forbiddenRefunds).toMatch(/permission denied/);
    expect(result.pending).toEqual([{ payment_id: paidPayment, amount_xof: 5000 }]);
    expect(result.twice).toMatch(/not_refundable/);
    // Tri par état dans l'ordre de l'énumération app.payment_status
    expect(result.payments).toEqual([
      { id: paidPayment, status: "refunded", refunded_amount_xof: 5000 },
      { id: pendingPayment, status: "cancelled", refunded_amount_xof: 0 },
    ]);
    expect(result.regs).toEqual([{ status: "cancelled" }]);
    expect(result.waitlist).toBe(0);
    expect(result.notified).toEqual([paid, unpaid, waiting].sort());
    expect(result.status).toBe("cancelled");
  });

  it("modification impossible après la préparation des tables ; annulation impossible une fois la soirée commencée", async () => {
    const event = await createEvent(db, { startsInHours: 120 });
    const venue = await createVenue(db);
    await register(db, event, await createMember(db, { firstName: "Iyabo", sex: "female" }), "female", "checked_in");
    await register(db, event, await createMember(db, { firstName: "Jérôme", sex: "male" }), "male", "checked_in");
    const result = await asUser(db, admin, async (tx) => {
      await tx.query("select app.prepare_evening($1)", [event]);
      const edit = await attempt(tx, SAVE_SQL, saveParams({ event, venue }));
      await tx.query("select app.start_evening($1)", [event]);
      const cancel = await attempt(tx, "select app.cancel_event($1)", [event]);
      return { edit, cancel };
    });
    expect(result.edit).toMatch(/not_editable/);
    expect(result.cancel).toMatch(/invalid_status/);
  });
});
