import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./db";
import { createMember, createVenue, type Sex } from "./fixtures";

/**
 * Étape 6 de PHASE2.txt, critère de fin de la phase 2 : simulation complète d'une soirée.
 * 24 profils fictifs (12 femmes, 12 hommes), une soirée 10 × 10 avec liste d'attente, puis :
 * réservation, paiement simulé, confirmation, pointage, 10 tours, votes, matchs annoncés à 8 h.
 *
 * Chaque étape passe par les fonctions de la base, appelées par le membre ou par l'équipe comme
 * le font le site et l'API ; les écritures sont validées (pas d'annulation entre les étapes).
 * Seule exception : l'horloge de la base de test ne peut pas avancer, les dates de la soirée et
 * de l'annonce sont donc reculées d'autant (« le temps passe »).
 */

let db: PGlite;
let admin: string;
let event: string;
let qr: string;
const women: string[] = [];
const men: string[] = [];

const womenNames = ["Afiavi", "Sènami", "Ayaba", "Fifamè", "Adjoavi", "Yétondé", "Kémi", "Folake", "Mahouna", "Nadège", "Houéfa", "Mariam"];
const menNames = ["Koffi", "Codjo", "Mawulé", "Rodrigue", "Dossou", "Comlan", "Gbènakpon", "Sèwanou", "Kossi", "Akim", "Yaovi", "Hounkpè"];

/** Requête validée au nom d'une personne (jeton du membre ou de l'équipier). */
async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** Tâche système de l'API (clé service role). */
async function asSystem<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    await tx.exec("set local role service_role");
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** Statut de chacun dans la soirée : inscription ou rang en liste d'attente. */
async function situation(user: string) {
  const [reg] = (await db.query<{ status: string }>("select status from app.event_registrations where event_id = $1 and user_id = $2", [event, user])).rows;
  const [wait] = (await db.query<{ position: number }>("select position from app.waitlist_entries where event_id = $1 and user_id = $2", [event, user])).rows;
  return reg?.status ?? (wait ? `waitlist:${wait.position}` : null);
}

/** Paiement simulé de la place, comme l'API (startEveningPayment puis succeedSimulated). */
async function paySimulated(user: string) {
  const [payment] = await asSystem<{ id: string }>(
    `insert into app.payments (user_id, purpose, amount_xof, provider, status)
     select $1, 'evening_booking', price_xof, 'simulated', 'pending' from app.events where id = $2 returning id`,
    [user, event],
  );
  await asSystem("update app.payments set provider_transaction_id = 'sim_' || id where id = $1", [payment!.id]);
  await asSystem("update app.event_registrations set payment_id = $1 where event_id = $2 and user_id = $3", [payment!.id, event, user]);
  await asSystem("update app.payments set status = 'succeeded' where id = $1 and status = 'pending'", [payment!.id]);
  await asSystem(
    "insert into app.audit_log (actor_id, action, target_table, target_id) values ($1, 'payment.simulated_succeeded', 'payments', $2)",
    [user, payment!.id],
  );
}

/** Le temps passe : la soirée (et, si besoin, l'annonce des matchs) recule de l'intervalle donné. */
async function timePasses(interval: string) {
  await db.query("update app.events set starts_at = starts_at - $2::interval where id = $1", [event, interval]);
}

/** Règle de vote de la simulation : la femme n° i et l'homme n° j disent oui selon (i + j). */
const womanSaysYes = (i: number, j: number) => (i + j) % 4 === 0;
const manSaysYes = (i: number, j: number) => (i + j) % 2 === 0;

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  for (const [names, list, sex] of [
    [womenNames, women, "female"],
    [menNames, men, "male"],
  ] as Array<[string[], string[], Sex]>) {
    for (const firstName of names) list.push(await createMember(db, { firstName, sex, photo: true }));
  }
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Simulation complète d'une soirée 10 × 10 (étape 6)", () => {
  it("l'équipe crée la soirée (10 000 FCFA, lieu fictif) et la publie", async () => {
    const venue = await createVenue(db);
    const [created] = await as<{ id: string }>(
      admin,
      "select app.save_event(null, $1, null, now() + interval '5 days', 10::smallint, 10::smallint, 7::smallint, 1::smallint, 10000) as id",
      [venue],
    );
    event = created!.id;
    await as(admin, "select app.publish_event($1)", [event]);
    const [row] = (await db.query<{ status: string; price_xof: number }>("select status, price_xof from app.events where id = $1", [event])).rows;
    expect(row).toEqual({ status: "published", price_xof: 10000 });
  });

  it("réservation : 10 places par sexe, les 2 suivants de chaque sexe en liste d'attente", async () => {
    for (let k = 0; k < 12; k++) {
      await as(women[k]!, "select app.book_event($1)", [event]);
      await as(men[k]!, "select app.book_event($1)", [event]);
    }
    expect(await Promise.all(women.map(situation))).toEqual([...Array(10).fill("booked"), "waitlist:1", "waitlist:2"]);
    expect(await Promise.all(men.map(situation))).toEqual([...Array(10).fill("booked"), "waitlist:1", "waitlist:2"]);
  });

  it("deux annulations avant paiement : la place va au premier en attente du même sexe, qui est prévenu", async () => {
    await as(women[3]!, "select app.cancel_registration($1)", [event]);
    await as(men[5]!, "select app.cancel_registration($1)", [event]);
    expect(await situation(women[3]!)).toBe("cancelled");
    expect(await situation(men[5]!)).toBe("cancelled");
    expect(await situation(women[10]!)).toBe("booked");
    expect(await situation(men[10]!)).toBe("booked");
    expect(await situation(women[11]!)).toMatch(/^waitlist:/);
    expect(await situation(men[11]!)).toMatch(/^waitlist:/);
    const offered = await db.query<{ user_id: string }>("select user_id from app.notifications where kind = 'evening.seat_offered' order by user_id");
    expect(offered.rows.map((n) => n.user_id)).toEqual([women[10], men[10]].sort());
  });

  it("paiement simulé puis confirmation des 20 participants avant la limite des 48 h", async () => {
    const seated = [...women, ...men].filter((_, k) => k !== 3 && k !== 12 + 5 && k !== 11 && k !== 23);
    expect(seated).toHaveLength(20);
    for (const user of seated) {
      await paySimulated(user);
      await as(user, "select app.confirm_registration($1)", [event]);
    }
    const regs = await db.query<{ status: string; paid: boolean }>(
      `select r.status, p.status = 'succeeded' as paid from app.event_registrations r
       left join app.payments p on p.id = r.payment_id where r.event_id = $1 and r.status <> 'cancelled'`,
      [event],
    );
    expect(regs.rows).toHaveLength(20);
    expect(regs.rows.every((r) => r.status === "confirmed" && r.paid)).toBe(true);
  });

  it("le soir venu : pointage par l'équipe, 10 tables et 10 tours sans pause, chaque femme rencontre chaque homme", async () => {
    await timePasses("5 days 10 minutes");
    const present = (await db.query<{ user_id: string; sex: Sex }>("select user_id, sex from app.event_registrations where event_id = $1 and status = 'confirmed'", [event])).rows;
    for (const { user_id } of present) await as(admin, "select app.check_in($1, $2)", [event, user_id]);
    const [prepared] = await as<{ n: number }>(admin, "select app.prepare_evening($1) as n", [event]);
    expect(prepared!.n).toBe(10);
    await as(admin, "select app.start_evening($1)", [event]);

    const pairings = (
      await db.query<{ round_number: number; woman_id: string | null; man_id: string | null }>(
        `select r.round_number, p.woman_id, p.man_id from app.round_pairings p join app.rounds r on r.id = p.round_id where r.event_id = $1`,
        [event],
      )
    ).rows;
    expect(new Set(pairings.map((p) => p.round_number)).size).toBe(10);
    expect(pairings).toHaveLength(100);
    expect(pairings.every((p) => p.woman_id && p.man_id)).toBe(true);
    expect(new Set(pairings.map((p) => `${p.woman_id}-${p.man_id}`)).size).toBe(100);
    qr = (await db.query<{ qr_token: string }>("select qr_token from app.event_tables where event_id = $1 and table_number = 1", [event])).rows[0]!.qr_token;
  });

  it("10 tours de votes par code QR : chacun vote pour la personne de chaque tour", async () => {
    const participants = (await db.query<{ user_id: string }>("select user_id from app.event_registrations where event_id = $1 and status = 'checked_in'", [event])).rows.map(
      (r) => r.user_id,
    );
    const index = (user: string) => (women.includes(user) ? women.indexOf(user) : men.indexOf(user));
    for (let round = 1; round <= 10; round++) {
      for (const user of participants) {
        const [pairing] = await as<{ target_id: string }>(user, "select target_id from app.voting_pairing($1, $2::smallint)", [qr, round]);
        const isWoman = women.includes(user);
        const [i, j] = isWoman ? [index(user), index(pairing!.target_id)] : [index(pairing!.target_id), index(user)];
        const yes = isWoman ? womanSaysYes(i, j) : manSaysYes(i, j);
        await as(user, "select app.cast_vote($1, $2::smallint, $3::app.vote_choice)", [qr, round, yes ? "yes" : "no"]);
      }
    }
    const [{ n }] = (await db.query<{ n: number }>("select count(*)::int as n from app.votes")).rows as [{ n: number }];
    expect(n).toBe(200);
  });

  it("fin de soirée : matchs sur double oui, annoncés le lendemain à 8 h et invisibles avant", async () => {
    await as(admin, "select app.finish_evening($1)", [event]);
    const [computed] = await as<{ n: number }>(admin, "select app.compute_matches($1) as n", [event]);

    const present = new Set(
      (await db.query<{ user_id: string }>("select user_id from app.event_registrations where event_id = $1 and status = 'checked_in'", [event])).rows.map((r) => r.user_id),
    );
    const expected: string[] = [];
    women.forEach((w, i) =>
      men.forEach((m, j) => {
        if (present.has(w) && present.has(m) && womanSaysYes(i, j) && manSaysYes(i, j)) expected.push([w, m].sort().join("+"));
      }),
    );
    expect(computed!.n).toBe(expected.length);
    const matches = (await db.query<{ member_a: string; member_b: string; announced_at: Date; expected: Date }>(
      `select m.member_a, m.member_b, m.announced_at, app.match_announcement_at(e.starts_at) as expected
       from app.matches m join app.events e on e.id = m.event_id where m.event_id = $1`,
      [event],
    )).rows;
    expect(matches.map((m) => [m.member_a, m.member_b].sort().join("+")).sort()).toEqual(expected.sort());
    expect(matches.every((m) => new Date(m.announced_at).getTime() === new Date(m.expected).getTime())).toBe(true);
    // 8 h, heure de Cotonou (UTC+1)
    expect(new Date(matches[0]!.announced_at).getUTCHours()).toBe(7);

    const someone = matches[0]!.member_a;
    expect(await as(someone, "select partner_first_name from app.my_matches()")).toEqual([]);
  });

  it("le lendemain à 8 h : annonce, une notification par membre concerné, chacun voit le prénom de ses matchs", async () => {
    const [{ wait }] = (await db.query<{ wait: string }>("select (max(announced_at) - now() + interval '1 minute')::text as wait from app.matches where event_id = $1", [event])).rows as [
      { wait: string },
    ];
    await timePasses(wait);
    await db.query("update app.matches set announced_at = announced_at - $2::interval where event_id = $1", [event, wait]);

    const [announced] = await asSystem<{ n: number }>("select app.announce_matches() as n");
    const matches = (await db.query<{ member_a: string; member_b: string }>("select member_a, member_b from app.matches where event_id = $1", [event])).rows;
    expect(announced!.n).toBe(matches.length * 2);

    const first = matches[0]!;
    const partnerName = [...womenNames, ...menNames][[...women, ...men].indexOf(first.member_b)];
    const seen = await as<{ partner_first_name: string }>(first.member_a, "select partner_first_name from app.my_matches()");
    expect(seen.map((m) => m.partner_first_name)).toContain(partnerName);

    // Les résultats de la soirée pour l'équipe
    const results = await as<Record<string, unknown>>(admin, "select * from app.event_matches($1)", [event]);
    expect(results).toHaveLength(matches.length);
  });
});
