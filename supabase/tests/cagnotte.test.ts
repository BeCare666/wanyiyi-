import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Cagnotte (phase 4, question 3 validée le 27 octobre 2026) : proposée par l'un, acceptée par
 * l'autre, après « Dot ou mariage » ou l'union ; contribution sans compte (par l'API), 1 000 FCFA
 * au moins ; le couple voit les contributions ; reversement demandé par les deux et fait à la main
 * par l'équipe ; clôture à la date ; séparation : contributions à rembourser.
 */

let db: PGlite;
const p: Record<string, string> = {};

async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** Comme l'API avec la clé service role (transaction validée). */
async function asApi<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    await tx.exec("set local role service_role");
    return (await tx.query<T>(sql, params)).rows;
  });
}

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

async function couple(a: string, b: string, status: string) {
  const event = await createEvent(db, { startsInHours: -48, status: "finished" });
  const m = await one<{ id: string }>(
    "insert into app.matches (event_id, member_a, member_b, announced_at, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now(), 'discovery_open') returning id",
    [event, a, b],
  );
  const d = await one<{ id: string }>("insert into app.discoveries (match_id, ends_at, status) values ($1, now(), 'continued') returning id", [m.id]);
  const c = await one<{ id: string }>(
    "insert into app.couples (discovery_id, member_a, member_b, status) values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), $4::app.couple_status) returning id",
    [d.id, a, b, status],
  );
  await db.query("insert into app.conversations (kind, couple_id) values ('couple', $1)", [c.id]);
  return c.id;
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const propose = (user: string, c: string, closes = inDays(30), phone = "+229 01 97 00 00 01") =>
  as<{ id: string }>(user, "select app.propose_cagnotte($1, 'Notre mariage', 500000, $2::date, $3) as id", [c, closes, phone]).then((r) => r[0]!.id);

/** Contribution par l'API, puis paiement réussi (comme après la relecture chez FeexPay). */
async function contribute(token: string, amount: number, opts: { name?: string | null; anonymous?: boolean; message?: string | null; hide?: boolean; pay?: boolean } = {}) {
  const [{ id }] = await asApi<{ id: string }>("select app.create_contribution($1, $2, $3, $4, $5, $6, 'simulated') as id", [
    token,
    opts.name === undefined ? "Tante Rose" : opts.name,
    opts.anonymous ?? false,
    opts.message ?? null,
    amount,
    opts.hide ?? false,
  ]);
  if (opts.pay !== false) await db.query("update app.payments set status = 'succeeded' where id = $1", [id]);
  return id;
}

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex, role] of [
    ["afiwa", "female", "member"],
    ["koffi", "male", "member"],
    ["sena", "female", "member"],
    ["dossou", "male", "member"],
    ["admin", "female", "admin"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name, sex, role });
  }
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Cagnotte (question 3)", () => {
  let c: string;
  let cagnotte: string;
  let token: string;

  it("ouverture après « Dot ou mariage », proposée par l'un, numéro et date contrôlés", async () => {
    c = await couple(p.afiwa!, p.koffi!, "active");
    expect(await failure(propose(p.afiwa!, c))).toMatch(/too_early/);
    await db.query("insert into app.couple_milestones (couple_id, kind, reached_at) values ($1, 'dowry_or_wedding', now())", [c]);
    expect(await failure(propose(p.sena!, c))).toMatch(/not_member/);
    expect(await failure(propose(p.afiwa!, c, inDays(95)))).toMatch(/invalid_closing/);
    expect(await failure(propose(p.afiwa!, c, inDays(30), "0197"))).toMatch(/invalid_phone/);
    expect(await failure(as(p.afiwa!, "select app.propose_cagnotte($1, 'Appelez le 97 00 00 01', null, $2::date, '+2290197000001')", [c, inDays(30)]))).toMatch(
      /contact_details/,
    );
    cagnotte = await propose(p.afiwa!, c);
    expect(await failure(propose(p.koffi!, c))).toMatch(/already_open/);
    // Pas encore ouverte : aucune contribution possible, aucun lien public
    const [mine] = await as<{ status: string; public_token: string | null }>(p.koffi!, "select * from app.my_cagnotte($1)", [c]);
    expect(mine).toMatchObject({ status: "proposed", public_token: null });
  });

  it("acceptée par l'autre seulement ; commission figée à l'ouverture", async () => {
    expect(await failure(as(p.afiwa!, "select app.answer_cagnotte($1, true)", [cagnotte]))).toMatch(/own_request/);
    await db.query("update app.settings set value = '2.5' where key = 'cagnotte.commission_percent'");
    expect((await as<{ r: string }>(p.koffi!, "select app.answer_cagnotte($1, true) as r", [cagnotte]))[0]!.r).toBe("open");
    await db.query("update app.settings set value = '0' where key = 'cagnotte.commission_percent'");
    const [row] = await as<{ status: string; public_token: string; commission_percent: string; payout_phone: string }>(p.afiwa!, "select * from app.my_cagnotte($1)", [c]);
    expect(row).toMatchObject({ status: "open", payout_phone: "+2290197000001" });
    expect(Number(row!.commission_percent)).toBe(2.5);
    expect(row!.public_token).toMatch(/^[0-9a-f]{64}$/);
    token = row!.public_token;
  });

  it("page publique sans compte : titre, objectif, progression ; ni noms ni photos", async () => {
    const [page] = await asAnon(db, async (tx) => (await tx.query<Record<string, unknown>>("select * from app.public_cagnotte($1)", [token])).rows);
    expect(page).toMatchObject({ title: "Notre mariage", goal_xof: 500000, progress_percent: 0, accepting: true, min_contribution_xof: 1000 });
    expect(await asAnon(db, async (tx) => (await tx.query("select * from app.public_cagnotte('inconnu')")).rows)).toEqual([]);
    expect(await asAnon(db, (tx) => failure(tx.query("select * from app.cagnottes")))).toMatch(/permission denied/);
    expect(await asAnon(db, (tx) => failure(tx.query("select app.create_contribution($1, 'x', false, null, 5000, false, 'simulated')", [token])))).toMatch(
      /permission denied/,
    );
  });

  it("contributions : 1 000 FCFA au moins, nom ou « Anonyme », message filtré ; comptées une fois payées", async () => {
    expect(await failure(contribute(token, 999))).toMatch(/invalid_amount/);
    expect(await failure(contribute(token, 5000, { name: " " }))).toMatch(/name_required/);
    expect(await failure(contribute(token, 5000, { message: "Écrivez-moi au 97 00 00 01" }))).toMatch(/contact_details/);
    expect(await failure(contribute(token, 5000, { message: "x".repeat(301) }))).toMatch(/message_too_long/);
    await contribute(token, 100000, { message: "Tous nos vœux de bonheur" });
    await contribute(token, 50000, { name: null, anonymous: true, hide: true });
    await contribute(token, 20000, { pay: false });
    const list = await as<{ contributor_name: string | null; message: string | null; amount_xof: number | null }>(p.koffi!, "select * from app.cagnotte_contributions($1)", [
      cagnotte,
    ]);
    expect(list).toHaveLength(2);
    expect(list.map((r) => [r.contributor_name, r.amount_xof])).toEqual(expect.arrayContaining([["Tante Rose", 100000], [null, null]]));
    expect(await as(p.sena!, "select * from app.cagnotte_contributions($1)", [cagnotte])).toEqual([]);
    const [page] = await asAnon(db, async (tx) => (await tx.query<{ progress_percent: number }>("select * from app.public_cagnotte($1)", [token])).rows);
    expect(page!.progress_percent).toBe(30);
    const notes = await one<{ n: number }>("select count(*)::int as n from app.notifications where user_id = $1 and kind = 'cagnotte.contribution'", [p.afiwa]);
    expect(notes.n).toBe(2);
  });

  it("reversement demandé par les deux, commission déduite, fait à la main par l'équipe", async () => {
    expect((await as<{ r: string }>(p.afiwa!, "select app.cagnotte_decide($1, 'payout') as r", [cagnotte]))[0]!.r).toBe("recorded");
    expect((await as<{ r: string }>(p.koffi!, "select app.cagnotte_decide($1, 'payout') as r", [cagnotte]))[0]!.r).toBe("payout_requested");
    expect(await failure(as(p.afiwa!, "select app.cagnotte_decide($1, 'payout')", [cagnotte]))).toMatch(/payout_pending/);
    const [admin] = await as<{ payouts: Array<{ id: string; gross_xof: number; commission_xof: number; payout_phone: string }> }>(
      p.admin!,
      "select * from app.admin_cagnotte($1)",
      [cagnotte],
    );
    const payout = admin!.payouts[0]!;
    expect(payout).toMatchObject({ gross_xof: 150000, commission_xof: 3750, payout_phone: "+2290197000001" });
    expect(await failure(as(p.afiwa!, "select app.admin_mark_payout_paid($1, 140000, 'MP123')", [payout.id]))).toMatch(/forbidden/);
    expect(await failure(as(p.admin!, "select app.admin_mark_payout_paid($1, 150000, 'MP123')", [payout.id]))).toMatch(/invalid_amount/);
    expect(await failure(as(p.admin!, "select app.admin_mark_payout_paid($1, 145000, ' ')", [payout.id]))).toMatch(/reference_required/);
    await as(p.admin!, "select app.admin_mark_payout_paid($1, 144000, 'MP123')", [payout.id]);
    const [row] = await as<{ status: string; paid_out_xof: number; payout_pending: boolean }>(p.afiwa!, "select * from app.my_cagnotte($1)", [c]);
    expect(row).toMatchObject({ status: "open", paid_out_xof: 144000, payout_pending: false });
    // La cagnotte reste ouverte : une contribution suivante pourra être reversée à son tour
    expect(await failure(as(p.afiwa!, "select app.cagnotte_decide($1, 'payout')", [cagnotte]))).toMatch(/nothing_to_pay_out/);
    // Choix C : moins de 10 000 FCFA à reverser tant qu'elle est ouverte : demande refusée
    await contribute(token, 5000);
    expect(await failure(as(p.afiwa!, "select app.cagnotte_decide($1, 'payout')", [cagnotte]))).toMatch(/payout_too_small/);
  });

  it("clôture à la date par la tâche de l'API, reversement proposé ; entièrement reversée ensuite", async () => {
    await contribute(token, 3000);
    await db.query("update app.cagnottes set closes_at = now() - interval '1 minute' where id = $1", [cagnotte]);
    expect((await asApi<{ n: number }>("select app.close_due_cagnottes() as n"))[0]!.n).toBe(1);
    expect(await failure(contribute(token, 5000))).toMatch(/cagnotte_closed/);
    const closed = await one<{ n: number }>("select count(*)::int as n from app.notifications where user_id = $1 and kind = 'cagnotte.closed'", [p.koffi]);
    expect(closed.n).toBe(1);
    await as(p.afiwa!, "select app.cagnotte_decide($1, 'payout')", [cagnotte]);
    await as(p.koffi!, "select app.cagnotte_decide($1, 'payout')", [cagnotte]);
    const [admin] = await as<{ payouts: Array<{ id: string; status: string; gross_xof: number }> }>(p.admin!, "select * from app.admin_cagnotte($1)", [cagnotte]);
    const pending = admin!.payouts.find((o) => o.status === "requested")!;
    // Close : aucun minimum (choix C), 5 000 + 3 000 FCFA reversés
    expect(pending.gross_xof).toBe(8000);
    await as(p.admin!, "select app.admin_mark_payout_paid($1, 7500, 'MP124')", [pending.id]);
    expect((await as<{ status: string }>(p.afiwa!, "select * from app.my_cagnotte($1)", [c]))[0]!.status).toBe("paid_out");
  });

  it("séparation : cagnotte fermée, reversement en attente annulé, contributions à rembourser", async () => {
    const other = await couple(p.sena!, p.dossou!, "union_celebrated");
    const id = await propose(p.sena!, other);
    await as(p.dossou!, "select app.answer_cagnotte($1, true)", [id]);
    const [{ public_token }] = await as<{ public_token: string }>(p.sena!, "select * from app.my_cagnotte($1)", [other]);
    const paid = await contribute(public_token, 30000);
    await as(p.sena!, "select app.cagnotte_decide($1, 'payout')", [id]);
    await as(p.dossou!, "select app.cagnotte_decide($1, 'payout')", [id]);
    await db.query("update app.couples set status = 'separated', ended_at = now() where id = $1", [other]);
    const g = await one<{ status: string; closed_reason: string }>("select status, closed_reason from app.cagnottes where id = $1", [id]);
    expect(g).toEqual({ status: "closed", closed_reason: "separation" });
    expect((await one<{ s: string }>("select status as s from app.cagnotte_payouts where cagnotte_id = $1", [id])).s).toBe("cancelled");
    expect((await one<{ r: boolean }>("select refund_requested_at is not null as r from app.payments where id = $1", [paid])).r).toBe(true);
  });

  it("réglages de l'administration : minimum et commission", async () => {
    expect(await failure(as(p.afiwa!, "select app.admin_set_cagnotte_settings(2000, 1, 10000)"))).toMatch(/forbidden/);
    expect(await failure(as(p.admin!, "select app.admin_set_cagnotte_settings(2000, 60, 10000)"))).toMatch(/invalid_commission/);
    expect(await failure(as(p.admin!, "select app.admin_set_cagnotte_settings(2000, 1, -1)"))).toMatch(/invalid_min_payout/);
    await as(p.admin!, "select app.admin_set_cagnotte_settings(2000, 1.5, 20000)");
    expect((await as<{ min_payout_xof: number }>(p.admin!, "select * from app.cagnotte_settings()"))[0]!.min_payout_xof).toBe(20000);
    expect(Number((await one<{ v: string }>("select app.cagnotte_commission_percent() as v")).v)).toBe(1.5);
    expect((await one<{ v: number }>("select app.setting_int('cagnotte.min_contribution_xof', 0) as v")).v).toBe(2000);
  });

  it("liste filtrable de l'administration", async () => {
    const rows = await as<{ row: { title: string; to_refund: boolean } }>(
      p.admin!,
      "select r as row from app.admin_list('cagnottes', $1, null, 50, 0) r",
      [JSON.stringify({ field: "to_refund", cmp: "is", value: true })],
    );
    expect(rows).toHaveLength(1);
    expect(await failure(as(p.afiwa!, "select * from app.admin_list('cagnottes')"))).toMatch(/forbidden/);
  });
});

describe("Indicateurs du tableau de bord (phase 4, question 6)", () => {
  it("chacun réservé à la permission de son module", async () => {
    const [row] = await as<Record<string, number | string | null>>(p.admin!, "select * from app.admin_phase4_indicators()");
    expect(row!.open_cagnottes).toBe(0);
    expect(Number(row!.collected_xof)).toBe(188000);
    expect(row!.pending_payouts).toBe(0);
    expect(row!.referrals_this_month).toBe(0);
    expect(row!.active_providers).toBe(0);
    expect(await failure(as(p.afiwa!, "select * from app.admin_phase4_indicators()"))).toMatch(/forbidden/);
  });
});
