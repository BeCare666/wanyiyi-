import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Administration de la phase 3 : matchs et découvertes (11.2-6), couples (11.2-7) par le moteur
 * de filtres ; conseillers (11.2-8, question 9 a) créés par l'administration.
 */

let db: PGlite;
const p: Record<string, string> = {};
let couple: string;

/** Requête gardée (transaction validée), au nom d'une personne de l'équipe. */
async function as(user: string, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query(sql, params)).rows;
  });
}

const list = (user: string, name: string, filter: unknown = null, sort: unknown = null) =>
  asUser(db, user, async (tx) =>
    (
      await tx.query<{ row: Record<string, unknown> }>("select r as row from app.admin_list($1, $2, $3, 200, 0) r", [
        name,
        filter === null ? null : JSON.stringify(filter),
        sort === null ? null : JSON.stringify(sort),
      ])
    ).rows.map((r) => r.row),
  );

beforeAll(async () => {
  db = await createDb();
  p.admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  p.superAdmin = await createMember(db, { firstName: "Gbènakpon", sex: "male", role: "super_admin" });
  p.moderator = await createMember(db, { firstName: "Sèna", sex: "female", role: "moderator" });
  for (const [name, sex] of [
    ["afiwa", "female"],
    ["koffi", "male"],
    ["ablavi", "female"],
    ["dossou", "male"],
    ["future", "female"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name[0]!.toUpperCase() + name.slice(1), sex });
  }
  const event = await createEvent(db, { startsInHours: -48, status: "finished" });
  const match = async (a: string, b: string, status: string) =>
    (
      await db.query<{ id: string }>(
        "insert into app.matches (event_id, member_a, member_b, announced_at, notified_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now() - interval '1 day', now() - interval '1 day', $4::app.match_status) returning id",
        [event, a, b, status],
      )
    ).rows[0]!.id;
  const m1 = await match(p.afiwa!, p.koffi!, "discovery_open");
  await match(p.ablavi!, p.dossou!, "pending_choice");
  const d1 = (await db.query<{ id: string }>("insert into app.discoveries (match_id, ends_at, status) values ($1, now() + interval '3 days', 'continued') returning id", [m1]))
    .rows[0]!.id;
  couple = (
    await db.query<{ id: string }>(
      "insert into app.couples (discovery_id, member_a, member_b, last_activity_at) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now() - interval '61 days') returning id",
      [d1, p.afiwa, p.koffi],
    )
  ).rows[0]!.id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Administration de la phase 3", () => {
  it("matchs et découvertes : état du match, de la découverte, échéance ; réservé à events.manage", async () => {
    const all = await list(p.admin!, "discoveries");
    expect(all).toHaveLength(2);
    const waiting = await list(p.admin!, "discoveries", { field: "discovery_status", cmp: "in", value: ["none"] });
    expect(waiting.map((r) => r.a_first_name ?? r.b_first_name)).toHaveLength(1);
    expect(waiting[0]!.match_status).toBe("pending_choice");
    const named = await list(p.admin!, "discoveries", { field: "member", cmp: "contains", value: "dossou" });
    expect(named).toHaveLength(1);
    expect(await asUser(db, p.moderator!, (tx) => failure(tx.query("select * from app.admin_list('discoveries')")))).toMatch(/forbidden/);
  });

  it("couples : jours sans activité (règle des 60 jours), conseiller ; réservé à couples.read", async () => {
    const inactive = await list(p.admin!, "couples", { field: "inactive_days", cmp: "between", value: [60, null] });
    expect(inactive.map((r) => r.id)).toEqual([couple]);
    expect(inactive[0]!.inactive_days).toBe(61);
    expect(await list(p.admin!, "couples", { field: "has_counselor", cmp: "is", value: true })).toEqual([]);
    expect(await asUser(db, p.moderator!, (tx) => failure(tx.query("select * from app.admin_list('couples')")))).toMatch(/forbidden/);
  });

  it("conseiller créé par l'administration à partir d'un compte membre ; journalisé", async () => {
    const create = (user: string, target: string, name = "Mme Conseillère", max = 10) =>
      failure(as(user, "select app.admin_create_counselor($1, $2, 'Accompagne les couples', '{fr,yo}', $3)", [target, name, max]));
    expect(await create(p.moderator!, p.future!)).toMatch(/forbidden/);
    expect(await create(p.admin!, p.future!, " ")).toMatch(/name_required/);
    expect(await create(p.admin!, p.future!, "Mme Conseillère", 0)).toMatch(/invalid_capacity/);
    expect(await create(p.admin!, p.moderator!)).toMatch(/not_a_member/);
    expect(await create(p.admin!, p.future!)).toBeNull();
    const { rows } = await db.query<{ role: string }>("select role from app.users where id = $1", [p.future]);
    expect(rows[0]!.role).toBe("counselor");
    expect(await create(p.admin!, p.future!)).toMatch(/not_a_member/);
    const { rows: audit } = await db.query<{ action: string }>("select action from app.audit_log where target_id = $1 order by created_at", [p.future]);
    expect(audit.map((a) => a.action)).toEqual(["role.changed", "counselor.created"]);
  });

  it("l'administration ne change aucun autre rôle ; mise à jour et charge du conseiller", async () => {
    await as(p.admin!, "update app.users set role = 'admin' where id = $1", [p.ablavi]);
    const { rows: still } = await db.query<{ role: string }>("select role from app.users where id = $1", [p.ablavi]);
    expect(still[0]!.role).toBe("member");
    expect(
      await failure(as(p.admin!, "select app.admin_update_counselor($1, 'Mme C.', null, '{fr}', 5, false)", [p.future])),
    ).toBeNull();
    await db.query("update app.couples set counselor_id = $1 where id = $2", [p.future, couple]);
    const [row] = await asUser(db, p.admin!, async (tx) =>
      (await tx.query<{ display_name: string; is_available: boolean; active_couples: number; max_couples: number }>("select * from app.admin_counselors()")).rows,
    );
    expect(row).toMatchObject({ display_name: "Mme C.", is_available: false, active_couples: 1, max_couples: 5 });
  });

  it("les listes déjà livrées passent toujours par le moteur", async () => {
    expect(await list(p.admin!, "events")).toHaveLength(1);
    expect(await list(p.admin!, "events", null, [{ field: "starts_at", dir: "asc" }])).toHaveLength(1);
  });
});
