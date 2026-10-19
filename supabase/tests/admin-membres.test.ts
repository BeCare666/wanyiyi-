import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Module « Membres » de l'administration (section 11.2-2, décisions du 19 octobre 2026) :
 * liste, fiche, historique ; suspension, réactivation, exclusion, blocage des soirées,
 * changement de rôle. Réservé à l'administration et à la super administration.
 */

let db: PGlite;
let admin: string;
let superAdmin: string;
let moderator: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  superAdmin = await createMember(db, { firstName: "Gbènakpon", sex: "male", role: "super_admin" });
  moderator = await createMember(db, { firstName: "Sèna", sex: "male", role: "moderator" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const rows = async <T>(p: Promise<{ rows: T[] }>) => (await p).rows;

async function attempt(tx: Transaction, sql: string, params: unknown[] = []) {
  await tx.exec("savepoint essai");
  const error = await failure(tx.query(sql, params));
  await tx.exec(error ? "rollback to savepoint essai" : "release savepoint essai");
  return error;
}

const actAs = (tx: Transaction, userId: string) =>
  tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);

const statusOf = async (tx: Transaction, userId: string) =>
  (await rows(tx.query<{ status: string }>("select status from app.member_profiles where user_id = $1", [userId])))[0]?.status;

describe("Droits", () => {
  it("modérateur et membre : ni liste, ni fiche, ni action ; plus d'écriture directe sur les profils", async () => {
    const member = await createMember(db, { firstName: "Afiwa", sex: "female" });
    for (const user of [moderator, member]) {
      const errors = await asUser(db, user, async (tx) => ({
        list: await attempt(tx, "select * from app.admin_members()"),
        card: await attempt(tx, "select * from app.admin_member($1)", [member]),
        history: await attempt(tx, "select * from app.member_history($1)", [member]),
        suspend: await attempt(tx, "select app.suspend_member($1, 'motif')", [member]),
        reactivate: await attempt(tx, "select app.reactivate_member($1)", [member]),
        exclude: await attempt(tx, "select app.exclude_member($1, 'motif')", [member]),
        block: await attempt(tx, "select app.block_member_evenings($1, now() + interval '30 days')", [member]),
        role: await attempt(tx, "select app.set_member_role($1, 'admin')", [member]),
      }));
      for (const [what, error] of Object.entries(errors)) expect(error, what).toMatch(/forbidden/);
    }
    const direct = await asUser(db, admin, (tx) =>
      rows(tx.query("update app.member_profiles set status = 'excluded' where user_id = $1 returning user_id", [member])),
    );
    expect(direct).toHaveLength(0);
  });
});

describe("Liste et fiche", () => {
  it("recherche par prénom, numéro ou téléphone, filtres, pagination côté serveur", async () => {
    const a = await createMember(db, { firstName: "Mahougnon", sex: "female" });
    await createMember(db, { firstName: "Comlan", sex: "male" });
    await createMember(db, { firstName: "Houéfa", sex: "female", status: "pending_verification" });
    const result = await asUser(db, admin, async (tx) => {
      const [{ member_number, phone }] = (await rows(
        tx.query<{ member_number: string; phone: string }>("select member_number, phone from app.users where id = $1", [a]),
      )) as [{ member_number: string; phone: string }];
      const ids = async (sql: string, params: unknown[]) => (await rows(tx.query<{ user_id: string }>(sql, params))).map((r) => r.user_id);
      return {
        byName: await ids("select user_id from app.admin_members('mahou')", []),
        byNumber: await ids("select user_id from app.admin_members($1)", [member_number]),
        byPhone: await ids("select user_id from app.admin_members($1)", [phone.slice(-5)]),
        pending: (await rows(tx.query<{ first_name: string }>("select first_name from app.admin_members(null, 'pending_verification')"))).map((r) => r.first_name),
        men: (await rows(tx.query<{ sex: string }>("select sex from app.admin_members(null, null, null, 'male')"))).every((r) => r.sex === "male"),
        staff: (await rows(tx.query<{ role: string }>("select role from app.admin_members(null, null, 'admin')"))).map((r) => r.role),
        page: await rows(tx.query<{ total: number }>("select total from app.admin_members(null, null, null, null, 2, 0)")),
      };
    });
    expect(result.byName).toEqual([a]);
    expect(result.byNumber).toEqual([a]);
    expect(result.byPhone).toEqual([a]);
    expect(result.pending).toContain("Houéfa");
    expect(result.men).toBe(true);
    expect(result.staff).toEqual(["admin"]);
    expect(result.page).toHaveLength(2);
    expect(result.page[0]!.total).toBeGreaterThan(2);
  });

  it("fiche et historique : soirées, sanctions ; aucun vote", async () => {
    const member = await createMember(db, { firstName: "Ayaba", sex: "female" });
    const event = await createEvent(db, { startsInHours: 72 });
    await register(db, event, member, "female", "confirmed");
    const result = await asUser(db, admin, async (tx) => {
      await tx.query("select app.suspend_member($1, 'Retards répétés')", [member]);
      const [card] = await rows(tx.query<Record<string, unknown>>("select first_name, status, role from app.admin_member($1)", [member]));
      const history = await rows(tx.query<{ kind: string; detail: Record<string, unknown> }>("select kind, detail from app.member_history($1)", [member]));
      return { card, kinds: history.map((h) => h.kind), sanction: history.find((h) => h.kind === "sanction.suspension")?.detail };
    });
    expect(result.card).toEqual({ first_name: "Ayaba", status: "suspended", role: "member" });
    expect(result.kinds).toEqual(expect.arrayContaining(["account.created", "evening.confirmed", "sanction.suspension"]));
    expect(result.kinds.some((k) => k.includes("vote"))).toBe(false);
    expect(result.sanction).toMatchObject({ reason: "Retards répétés", ends_at: null });
  });
});

describe("Actions", () => {
  it("suspension : motif obligatoire, notification avec le motif, réservation et vote refusés ; réactivation à l'état d'avant", async () => {
    const member = await createMember(db, { firstName: "Nafi", sex: "female" });
    const event = await createEvent(db, { startsInHours: 120 });
    const flow = await asUser(db, admin, async (tx) => {
      const steps: Record<string, unknown> = {};
      steps.noReason = await attempt(tx, "select app.suspend_member($1, '  ')", [member]);
      steps.self = await attempt(tx, "select app.suspend_member($1, 'motif')", [admin]);
      await tx.query("select app.suspend_member($1, 'Comportement irrespectueux')", [member]);
      steps.twice = await attempt(tx, "select app.suspend_member($1, 'encore')", [member]);
      steps.status = await statusOf(tx, member);

      await actAs(tx, member);
      steps.notification = (await rows(tx.query<{ kind: string; payload: unknown }>("select kind, payload from app.notifications where user_id = $1", [member])))[0];
      steps.book = await attempt(tx, "select app.book_event($1)", [event]);
      steps.vote = await attempt(tx, "select * from app.voting_pairing('nimporte', 1::smallint)");

      await actAs(tx, admin);
      await tx.query("select app.reactivate_member($1)", [member]);
      steps.after = await statusOf(tx, member);
      steps.reactivateAgain = await attempt(tx, "select app.reactivate_member($1)", [member]);
      await tx.exec("reset role");
      steps.audit = (await rows(tx.query<{ action: string }>("select action from app.audit_log where target_id = $1 order by id", [member]))).map((a) => a.action);
      steps.ended = (await rows(tx.query<{ ended: boolean }>("select ends_at is not null as ended from app.sanctions where user_id = $1", [member])))[0]?.ended;
      return steps;
    });
    expect(flow.noReason).toMatch(/reason_required/);
    expect(flow.self).toMatch(/self_action/);
    expect(flow.twice).toMatch(/invalid_status/);
    expect(flow.status).toBe("suspended");
    expect(flow.notification).toEqual({ kind: "member.suspended", payload: { reason: "Comportement irrespectueux" } });
    expect(flow.book).toMatch(/not_validated/);
    expect(flow.vote).toMatch(/member_inactive/);
    expect(flow.after).toBe("verified");
    expect(flow.reactivateAgain).toMatch(/invalid_status/);
    expect(flow.audit).toEqual(["member.suspended", "member.reactivated"]);
    expect(flow.ended).toBe(true);
  });

  it("exclusion définitive, motif notifié ; pointage refusé ensuite", async () => {
    const member = await createMember(db, { firstName: "Sênami", sex: "female" });
    const event = await createEvent(db, { startsInHours: 1 });
    await register(db, event, member, "female", "confirmed");
    const flow = await asUser(db, admin, async (tx) => {
      await tx.query("select app.exclude_member($1, 'Fausse déclaration')", [member]);
      return {
        status: await statusOf(tx, member),
        reactivate: await attempt(tx, "select app.reactivate_member($1)", [member]),
        suspend: await attempt(tx, "select app.suspend_member($1, 'motif')", [member]),
        checkIn: await attempt(tx, "select app.check_in($1, $2)", [event, member]),
        // Lue par le membre lui-même : l'équipe ne lit pas ses notifications
        notification: await actAs(tx, member).then(() => rows(tx.query("select kind, payload from app.notifications where user_id = $1", [member]))),
      };
    });
    expect(flow.status).toBe("excluded");
    expect(flow.reactivate).toMatch(/invalid_status/);
    expect(flow.suspend).toMatch(/invalid_status/);
    expect(flow.checkIn).toMatch(/member_inactive/);
    expect(flow.notification).toEqual([{ kind: "member.excluded", payload: { reason: "Fausse déclaration" } }]);
  });

  it("blocage des soirées jusqu'à une date, puis levée ; date passée refusée", async () => {
    const member = await createMember(db, { firstName: "Codjo", sex: "male" });
    const event = await createEvent(db, { startsInHours: 120 });
    const flow = await asUser(db, admin, async (tx) => {
      const past = await attempt(tx, "select app.block_member_evenings($1, now() - interval '1 day')", [member]);
      await tx.query("select app.block_member_evenings($1, now() + interval '30 days')", [member]);
      await actAs(tx, member);
      const blocked = await attempt(tx, "select app.book_event($1)", [event]);
      await actAs(tx, admin);
      await tx.query("select app.block_member_evenings($1, null)", [member]);
      await actAs(tx, member);
      const [{ outcome }] = (await rows(tx.query<{ outcome: string }>("select app.book_event($1) as outcome", [event]))) as [{ outcome: string }];
      return { past, blocked, outcome };
    });
    expect(flow.past).toMatch(/date_in_past/);
    expect(flow.blocked).toMatch(/blocked_until/);
    expect(flow.outcome).toBe("seat");
  });

  it("rôle : super administration seulement, jamais le sien, journalisé", async () => {
    const member = await createMember(db, { firstName: "Kpodé", sex: "male" });
    const flow = await asUser(db, superAdmin, async (tx) => {
      const self = await attempt(tx, "select app.set_member_role($1, 'member')", [superAdmin]);
      await tx.query("select app.set_member_role($1, 'moderator')", [member]);
      const [role] = await rows(tx.query<{ role: string }>("select role from app.users where id = $1", [member]));
      await tx.exec("reset role");
      const audit = await rows(tx.query<{ action: string }>("select action from app.audit_log where target_id = $1", [member]));
      return { self, role: role?.role, audit: audit.map((a) => a.action) };
    });
    expect(flow.self).toMatch(/self_action/);
    expect(flow.role).toBe("moderator");
    expect(flow.audit).toEqual(["role.changed"]);
    // L'administration (sans roles.manage) ne change pas les rôles
    expect(await asUser(db, admin, (tx) => failure(tx.query("select app.set_member_role($1, 'admin')", [member])))).toMatch(/forbidden/);
  });
});
