import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Parcours du couple (question 16) et lieux conseillés pour un premier rendez-vous (question 4),
 * règles validées le 27 octobre 2026.
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

async function couple(a: string, b: string) {
  const m = await one<{ id: string }>(
    "insert into app.matches (event_id, member_a, member_b, announced_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), 'discovery_open') returning id",
    [event, a, b],
  );
  const d = await one<{ id: string }>("insert into app.discoveries (match_id, ends_at, status) values ($1, now(), 'continued') returning id", [m.id]);
  const c = await one<{ id: string }>(
    "insert into app.couples (discovery_id, member_a, member_b, created_at) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now() - interval '30 days') returning id",
    [d.id, a, b],
  );
  const chat = await one<{ id: string }>("insert into app.conversations (kind, couple_id) values ('couple', $1) returning id", [c.id]);
  return { id: c.id, chat: chat.id };
}

const confirm = (user: string, c: string, kind: string, action: string) =>
  as<{ r: string }>(user, "select app.confirm_milestone($1, $2, $3) as r", [c, kind, action]).then((r) => r[0]!.r);
const reachedAt = async (c: string, kind: string) =>
  (await db.query<{ reached_at: Date | null }>("select reached_at from app.couple_milestones where couple_id = $1 and kind = $2", [c, kind])).rows[0]
    ?.reached_at ?? null;

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, role] of [
    ["afiwa", "female", "member"],
    ["koffi", "male", "member"],
    ["sena", "female", "member"],
    ["dossou", "male", "member"],
    ["conseillere", "female", "counselor"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, role });
  }
  await db.query("insert into app.counselors (user_id, display_name) values ($1, 'Mme Conseillère')", [p.conseillere]);
  event = await createEvent(db, { startsInHours: -48, status: "finished" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Parcours du couple (question 16)", () => {
  it("étape franchie quand les deux la confirment ; chacun ne voit que sa propre confirmation", async () => {
    const c = await couple(p.afiwa!, p.koffi!);
    expect(await confirm(p.afiwa!, c.id, "first_dates", "reach")).toBe("recorded");
    expect(await reachedAt(c.id, "first_dates")).toBeNull();
    const mine = await as<{ kind: string; i_confirmed_reach: boolean }>(p.koffi!, "select * from app.my_milestones($1)", [c.id]);
    expect(mine.find((m) => m.kind === "first_dates")!.i_confirmed_reach).toBe(false);
    expect(mine).toHaveLength(5);
    const { rows } = await db.query<{ body: string; sender_id: string }>("select body, sender_id from app.messages where conversation_id = $1 and is_system", [c.chat]);
    expect(rows).toEqual([{ body: "milestone.reach_requested:first_dates", sender_id: p.afiwa }]);
    expect(await confirm(p.koffi!, c.id, "first_dates", "reach")).toBe("done");
    expect(await reachedAt(c.id, "first_dates")).not.toBeNull();
    expect(await failure(as(p.afiwa!, "select app.confirm_milestone($1, 'first_dates', 'reach')", [c.id]))).toMatch(/invalid_status/);
    // Retrait par les deux
    expect(await confirm(p.koffi!, c.id, "first_dates", "remove")).toBe("recorded");
    expect(await confirm(p.afiwa!, c.id, "first_dates", "remove")).toBe("done");
    expect(await reachedAt(c.id, "first_dates")).toBeNull();
  });

  it("séances avec le conseiller : jamais à la main ; personne d'autre ne confirme", async () => {
    const c = await couple(p.sena!, p.dossou!);
    expect(await failure(as(p.sena!, "select app.confirm_milestone($1, 'counselor_sessions', 'reach')", [c.id]))).toMatch(/automatic_milestone/);
    expect(await failure(as(p.afiwa!, "select app.confirm_milestone($1, 'family_introduction', 'reach')", [c.id]))).toMatch(/not_member/);
  });

  it("date corrigée par l'un ou l'autre, ni dans le futur ni avant le couple ; le conseiller lit les étapes", async () => {
    const c = await couple(p.afiwa!, p.dossou!);
    await confirm(p.afiwa!, c.id, "family_introduction", "reach");
    await confirm(p.dossou!, c.id, "family_introduction", "reach");
    const day = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    expect(await failure(as(p.dossou!, "select app.set_milestone_date($1, 'family_introduction', $2)", [c.id, day]))).toBeNull();
    expect((await reachedAt(c.id, "family_introduction"))!.toISOString().slice(0, 10)).toBe(day);
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect(await failure(as(p.dossou!, "select app.set_milestone_date($1, 'family_introduction', $2)", [c.id, future]))).toMatch(/invalid_date/);
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    expect(await failure(as(p.dossou!, "select app.set_milestone_date($1, 'family_introduction', $2)", [c.id, old]))).toMatch(/invalid_date/);
    expect(await as(p.conseillere!, "select kind from app.couple_milestones where couple_id = $1", [c.id])).toEqual([]);
    await db.query(
      "insert into app.counselor_access (couple_id, counselor_id, requested_by, status, accepted_at, granted_at, price_xof) values ($1, $2, $3, 'granted', now(), now(), 0)",
      [c.id, p.conseillere, p.afiwa],
    );
    expect(await as(p.conseillere!, "select kind from app.couple_milestones where couple_id = $1", [c.id])).toEqual([{ kind: "family_introduction" }]);
  });
});

describe("Lieux conseillés pour un premier rendez-vous (question 4)", () => {
  it("visibles des membres en découverte ou en couple seulement", async () => {
    await db.query(
      "insert into app.venues (name, address, city, first_date_partner, district, venue_kind, opening_hours) values ('Café des Cocotiers', 'Rue 12', 'Cotonou', true, 'Haie Vive', 'cafe', '8 h - 22 h'), ('Salle privée', 'Rue 3', 'Cotonou', false, null, null, null)",
    );
    const lone = await createMember(db, { firstName: "seule", sex: "female" });
    expect(await as(lone, "select * from app.first_date_venues()")).toEqual([]);
    const venues = await as<{ name: string; district: string }>(p.afiwa!, "select * from app.first_date_venues()");
    expect(venues.map((v) => v.name)).toEqual(["Café des Cocotiers"]);
    expect(venues[0]!.district).toBe("Haie Vive");
  });
});
