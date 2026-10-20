import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Actions groupées de la liste des membres (section 11.3, décisions du 19 octobre 2026) :
 * notification en trois langues, invitation à une soirée ; file d'envoi SMS et e-mail.
 */

let db: PGlite;
let admin: string;
let moderator: string;
const people: Record<string, string> = {};
let event: string;

const body = { fr: "Bonjour, la soirée de vendredi est maintenue.", en: "Hello, Friday's evening is going ahead.", yo: "Ẹ n lẹ́, ìpàdé ọjọ́ Ẹtì ṣì ń lọ." };

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  moderator = await createMember(db, { firstName: "Sèna", sex: "male", role: "moderator" });
  people.ayaba = await createMember(db, { firstName: "Ayaba", sex: "female" });
  people.comlan = await createMember(db, { firstName: "Comlan", sex: "male" });
  people.houefa = await createMember(db, { firstName: "Houéfa", sex: "female", status: "pending_verification" });
  // Ayaba : e-mail confirmé, SMS coupé ; Comlan : aucun e-mail confirmé
  await db.query("update auth.users set email = 'ayaba@example.com', email_confirmed_at = now() where id = $1", [people.ayaba]);
  await db.query("update auth.users set email = 'comlan@example.com' where id = $1", [people.comlan]);
  await db.query("insert into app.notification_preferences (user_id, channel, enabled) values ($1, 'sms', false)", [people.ayaba]);
  event = await createEvent(db, { startsInHours: 72 });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const deliveriesOf = (tx: Transaction, userId: string) =>
  tx.query<{ kind: string; channel: string }>(
    "select n.kind, d.channel from app.notifications n left join app.notification_deliveries d on d.notification_id = n.id where n.user_id = $1 and n.kind in ('team.message', 'evening.invitation') order by d.channel::text",
    [userId],
  );

describe("Actions groupées (11.3)", () => {
  it("modérateur et membre : refusé ; la file d'envoi n'est lisible par personne côté site", async () => {
    for (const user of [moderator, people.ayaba!]) {
      const errors = await asUser(db, user, async (tx) => ({
        notify: await failure(tx.query("select app.admin_notify_members($1, null, $2)", [[people.comlan], JSON.stringify(body)])),
      }));
      expect(errors.notify).toMatch(/forbidden/);
    }
    const seen = await asUser(db, admin, async (tx) => (await tx.query("select * from app.notification_deliveries")).rows.length);
    expect(seen).toBe(0);
  });

  it("notification en trois langues aux membres cochés ; SMS et e-mail selon les canaux de chacun ; journalisée", async () => {
    const result = await asUser(db, admin, async (tx) => {
      const [{ count }] = (await tx.query<{ count: number }>("select app.admin_notify_members($1, null, $2) as count", [[people.ayaba, people.comlan], JSON.stringify(body)])).rows as [{ count: number }];
      await tx.exec("reset role");
      return {
        count,
        ayaba: (await deliveriesOf(tx, people.ayaba!)).rows,
        comlan: (await deliveriesOf(tx, people.comlan!)).rows,
        payload: (await tx.query<{ payload: unknown }>("select payload from app.notifications where user_id = $1 and kind = 'team.message'", [people.comlan])).rows[0]?.payload,
        audited: (await tx.query("select 1 from app.audit_log where action = 'members.notified'")).rows.length,
      };
    });
    expect(result.count).toBe(2);
    expect(result.ayaba).toEqual([{ kind: "team.message", channel: "email" }]); // SMS coupé par Ayaba
    expect(result.comlan.map((r) => r.channel)).toEqual(["email", "sms"]); // l'adresse non confirmée est écartée à l'envoi
    expect(result.payload).toEqual({ body });
    expect(result.audited).toBe(1);
  });

  it("cible par filtre ; message incomplet ou trop long refusé ; cible vide ou double refusée", async () => {
    const byFilter = await asUser(db, admin, (tx) =>
      tx.query<{ count: number }>("select app.admin_notify_members(null, $1, $2) as count", [
        JSON.stringify({ field: "status", cmp: "in", value: ["pending_verification"] }),
        JSON.stringify(body),
      ]),
    );
    expect(byFilter.rows[0]?.count).toBe(1);
    const errors = await asUser(db, admin, async (tx) => {
      const attempt = async (sql: string, params: unknown[]) => {
        await tx.exec("savepoint s");
        const error = await failure(tx.query(sql, params));
        await tx.exec("rollback to savepoint s");
        return error;
      };
      return [
        await attempt("select app.admin_notify_members($1, null, $2)", [[people.ayaba], JSON.stringify({ fr: "Bonjour", en: "Hello" })]),
        await attempt("select app.admin_notify_members($1, null, $2)", [[people.ayaba], JSON.stringify({ ...body, yo: "x".repeat(501) })]),
        await attempt("select app.admin_notify_members(null, null, $1)", [JSON.stringify(body)]),
        await attempt("select app.admin_notify_members($1, $2, $3)", [[people.ayaba], JSON.stringify({ field: "sanctioned", cmp: "is", value: true }), JSON.stringify(body)]),
        await attempt("select app.admin_notify_members($1, null, $2)", [[], JSON.stringify(body)]),
      ];
    });
    expect(errors).toEqual([
      expect.stringMatching(/invalid_message/),
      expect.stringMatching(/invalid_message/),
      expect.stringMatching(/invalid_targets/),
      expect.stringMatching(/invalid_targets/),
      expect.stringMatching(/invalid_targets/),
    ]);
  });

  it("invitation : soirée publiée à venir, membres validés seulement ; liste des soirées proposées", async () => {
    const result = await asUser(db, admin, async (tx) => {
      const [counts] = (await tx.query<{ invited: number; skipped: number }>("select * from app.admin_invite_members($1, null, $2)", [[people.ayaba, people.houefa], event])).rows;
      const events = (await tx.query<{ event_id: string }>("select event_id from app.invitable_events()")).rows.map((r) => r.event_id);
      await tx.exec("reset role");
      return { counts, events, ayaba: (await deliveriesOf(tx, people.ayaba!)).rows, houefa: (await deliveriesOf(tx, people.houefa!)).rows };
    });
    expect(result.counts).toEqual({ invited: 1, skipped: 1 });
    expect(result.events).toContain(event);
    expect(result.ayaba).toEqual([{ kind: "evening.invitation", channel: "email" }]);
    expect(result.houefa).toEqual([]);

    const draft = await createEvent(db, { startsInHours: 72, status: "draft" });
    const past = await createEvent(db, { startsInHours: -2, status: "in_progress" });
    for (const id of [draft, past]) {
      const error = await asUser(db, admin, (tx) => failure(tx.query("select * from app.admin_invite_members($1, null, $2)", [[people.ayaba], id])));
      expect(error).toMatch(/not_invitable/);
    }
  });

  it("file d'envoi (API) : langue, téléphone, e-mail confirmé seulement ; envoyé, retenté, abandonné après 5 échecs", async () => {
    const result = await asService(db, async (tx) => {
      await tx.query("select app.notify_with_deliveries($1, 'team.message', $2)", [people.comlan, JSON.stringify({ body })]);
      const pending = (
        await tx.query<{ delivery_id: string; channel: string; locale: string; phone: string | null; email: string | null }>(
          "select delivery_id, channel, locale, phone, email from app.pending_deliveries() order by channel::text",
        )
      ).rows;
      const [email, sms] = pending as [(typeof pending)[0], (typeof pending)[0]];
      await tx.query("select app.mark_delivery($1, true)", [sms.delivery_id]);
      await tx.query("select app.mark_delivery($1, false, 'aucune adresse confirmée', true)", [email.delivery_id]);
      const after = (await tx.query("select status, attempts from app.notification_deliveries order by channel::text")).rows;
      return { pending, after };
    });
    expect(result.pending).toEqual([
      expect.objectContaining({ channel: "email", locale: "fr", email: null }),
      expect.objectContaining({ channel: "sms", locale: "fr", phone: expect.stringMatching(/^\+229/) }),
    ]);
    expect(result.after).toEqual([
      { status: "failed", attempts: 1 },
      { status: "sent", attempts: 1 },
    ]);

    const retried = await asService(db, async (tx) => {
      await tx.query("select app.notify_with_deliveries($1, 'team.message', $2)", [people.ayaba, JSON.stringify({ body })]);
      const [{ delivery_id }] = (await tx.query<{ delivery_id: string }>("select delivery_id from app.pending_deliveries()")).rows as [{ delivery_id: string }];
      const statuses: string[] = [];
      for (let i = 0; i < 5; i++) {
        await tx.query("select app.mark_delivery($1, false, 'Brevo 503')", [delivery_id]);
        statuses.push((await tx.query<{ status: string }>("select status from app.notification_deliveries where id = $1", [delivery_id])).rows[0]!.status);
      }
      return statuses;
    });
    expect(retried).toEqual(["queued", "queued", "queued", "queued", "failed"]);
  });
});
