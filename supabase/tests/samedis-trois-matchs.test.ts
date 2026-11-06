import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, failure } from "./db";
import { createEvent, createMember, createVenue, register, type Sex } from "./fixtures";

/**
 * Demande du 06/11/2026 : samedis sur 10 mois (outil de l'équipe, soirées publiées), 15 × 15,
 * 20 000 FCFA, soirée complète = inscription d'office à la suivante, pointage automatique à la
 * préparation des tables, 3 matchs au plus par soirée ouverts aussitôt, 4 sujets de débat,
 * liste des discussions avec dernier message et accusé de lecture.
 */

let db: PGlite;
let admin: string;
let venue: string;

async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
const notices = async (user: string, kind: string) =>
  (await db.query<{ payload: Record<string, string> }>("select payload from app.notifications where user_id = $1 and kind = $2", [user, kind])).rows;

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  venue = await createVenue(db);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("Capacité 15 × 15 et prix 20 000 FCFA", () => {
  it("valeurs par défaut d'une soirée : 15 femmes, 15 hommes, 20 000 FCFA", async () => {
    const row = await one<{ w: number; m: number; p: number }>(
      "insert into app.events (venue_id, starts_at) values ($1, now() + interval '3 days') returning capacity_women as w, capacity_men as m, price_xof as p",
      [venue],
    );
    expect(row).toEqual({ w: 15, m: 15, p: 20000 });
    await db.query("delete from app.events where venue_id = $1", [venue]);
  });

  it("save_event accepte 15 × 15 et refuse 16", async () => {
    const save = (n: number) =>
      failure(
        as(admin, "select app.save_event(null, $1, null, now() + interval '4 days', $2::smallint, $2::smallint, 7::smallint, 1::smallint, 20000)", [venue, n]),
      );
    expect(await save(15)).toBeNull();
    expect(await save(16)).toMatch(/invalid_capacity/);
    await db.query("delete from app.events where venue_id = $1", [venue]);
  });

  it("la réduction du parrainage doit rester sous 20 000 FCFA", async () => {
    const set = (n: number) => failure(as(admin, "select app.admin_set_referral_settings($1, 5)", [n]));
    expect(await set(15000)).toBeNull();
    expect(await set(20000)).toMatch(/reward_too_high/);
  });
});

describe("Programmation des samedis", () => {
  it("une soirée publiée chaque samedi pendant 10 mois, à l'heure de Cotonou, avec 4 sujets", async () => {
    const [{ n }] = await as<{ n: number }>(admin, "select app.schedule_saturdays($1, current_date + 1, '19:00'::time) as n", [venue]);
    expect(n).toBeGreaterThanOrEqual(42);
    expect(n).toBeLessThanOrEqual(44);
    const rows = (
      await db.query<{ dow: number; hour: string; status: string; w: number; m: number; price: number; topics: string[] }>(
        `select extract(isodow from starts_at at time zone 'Africa/Porto-Novo')::int as dow,
                to_char(starts_at at time zone 'Africa/Porto-Novo', 'HH24:MI') as hour,
                status::text, capacity_women as w, capacity_men as m, price_xof as price, topics
           from app.events where venue_id = $1`,
        [venue],
      )
    ).rows;
    expect(rows).toHaveLength(n);
    for (const r of rows) {
      expect(r).toMatchObject({ dow: 6, hour: "19:00", status: "published", w: 15, m: 15, price: 20000 });
      expect(new Set(r.topics).size).toBe(4);
    }
    // Deux samedis qui se suivent n'ont pas les mêmes sujets
    const ordered = (await db.query<{ topics: string[] }>("select topics from app.events where venue_id = $1 order by starts_at limit 2", [venue])).rows;
    expect(ordered[0]!.topics).not.toEqual(ordered[1]!.topics);
  });

  it("relancée, elle ne double aucun samedi ; réservée à l'équipe", async () => {
    const [{ n }] = await as<{ n: number }>(admin, "select app.schedule_saturdays($1, current_date + 1, '19:00'::time) as n", [venue]);
    expect(n).toBe(0);
    const member = await createMember(db, { firstName: "Ayaba", sex: "female" });
    expect(await failure(as(member, "select app.schedule_saturdays($1, current_date, '19:00'::time)", [venue]))).toMatch(/forbidden/);
    expect(await failure(as(admin, "select app.schedule_saturdays($1, current_date, '19:00'::time, 13)", [venue]))).toMatch(/invalid_months/);
    await db.query("delete from app.events where venue_id = $1", [venue]);
  });
});

describe("Soirée complète : inscription d'office à la suivante", () => {
  let full: string;
  let themed: string;
  let next: string;
  let woman: string;

  beforeAll(async () => {
    full = await createEvent(db, { startsInHours: 48, capacityWomen: 1, capacityMen: 1 });
    // Soirée thématique entre les deux : réservée aux 50 ans et plus, sautée
    themed = await createEvent(db, { startsInHours: 72, theme: { minAge: 50 } });
    next = await createEvent(db, { startsInHours: 24 * 9 });
    await register(db, full, await createMember(db, { firstName: "Folake", sex: "female" }), "female", "booked");
    woman = await createMember(db, { firstName: "Houéfa", sex: "female", photo: true });
  });

  it("la place va à la prochaine soirée accessible qui a de la place ; aucune liste d'attente", async () => {
    const [{ outcome }] = await as<{ outcome: string }>(woman, "select app.book_event($1) as outcome", [full]);
    expect(outcome).toBe("next_evening");
    const regs = (await db.query<{ event_id: string; status: string }>("select event_id, status from app.event_registrations where user_id = $1", [woman])).rows;
    expect(regs).toEqual([{ event_id: next, status: "booked" }]);
    expect((await db.query("select 1 from app.waitlist_entries where user_id = $1", [woman])).rows).toHaveLength(0);
    expect(themed).not.toBe(next);
  });

  it("une seule alerte, qui dit quelle soirée était complète", async () => {
    expect(await notices(woman, "evening.booked")).toHaveLength(0);
    const [alert] = await notices(woman, "evening.moved_to_next");
    expect(alert?.payload).toMatchObject({ event_id: next, full_event_id: full, priced: false });
  });

  it("déjà inscrite à la suivante : la soirée d'après ; plus aucune : no_evening_available", async () => {
    const other = await createMember(db, { firstName: "Mariam", sex: "female", photo: true });
    await register(db, next, other, "female", "booked");
    const later = await createEvent(db, { startsInHours: 24 * 16 });
    const [{ outcome }] = await as<{ outcome: string }>(other, "select app.book_event($1) as outcome", [full]);
    expect(outcome).toBe("next_evening");
    expect((await db.query("select 1 from app.event_registrations where user_id = $1 and event_id = $2", [other, later])).rows).toHaveLength(1);
    await db.query("update app.events set status = 'cancelled' where id <> $1 and status = 'published'", [full]);
    const third = await createMember(db, { firstName: "Nadège", sex: "female", photo: true });
    expect(await failure(as(third, "select app.book_event($1)", [full]))).toMatch(/no_evening_available/);
  });
});

describe("Préparation des tables : pointage automatique", () => {
  it("15 + 15 places payées donnent 15 tables et 15 codes QR ; une place non payée n'est pas pointée", async () => {
    const event = await createEvent(db, { startsInHours: 1, capacityWomen: 15, capacityMen: 15 });
    for (const sex of ["female", "male"] as Sex[]) {
      for (let i = 0; i < 15; i++) {
        await register(db, event, await createMember(db, { firstName: `${sex}${i}`, sex }), sex, "confirmed");
      }
    }
    const unpaid = await createMember(db, { firstName: "Sènami", sex: "female" });
    await register(db, event, unpaid, "female", "booked");
    const [{ n }] = await as<{ n: number }>(admin, "select app.prepare_evening($1) as n", [event]);
    expect(n).toBe(15);
    const counts = await one<{ checked: number; tables: number; booked: string }>(
      `select (select count(*) from app.event_registrations where event_id = $1 and status = 'checked_in') as checked,
              (select count(*) from app.event_tables where event_id = $1) as tables,
              (select status from app.event_registrations where event_id = $1 and user_id = $2) as booked`,
      [event, unpaid],
    );
    expect(counts).toEqual({ checked: 30, tables: 15, booked: "booked" });
  });
});

describe("3 matchs au plus par soirée, ouverts aussitôt", () => {
  const w: string[] = [];
  const m: string[] = [];
  let event: string;

  beforeAll(async () => {
    event = await createEvent(db, { startsInHours: 1, capacityWomen: 4, capacityMen: 4 });
    for (let i = 0; i < 4; i++) {
      w.push(await createMember(db, { firstName: `Femme${i}`, sex: "female" }));
      m.push(await createMember(db, { firstName: `Homme${i}`, sex: "male" }));
      await register(db, event, w[i]!, "female", "confirmed");
      await register(db, event, m[i]!, "male", "confirmed");
    }
    await as(admin, "select app.prepare_evening($1)", [event]);
    // Oui mutuels : w0 avec les 4 hommes ; m0 aussi avec w1 et w2
    const yes = (a: string, b: string) =>
      db.query(
        `insert into app.votes (pairing_id, voter_id, target_id, choice)
         select p.id, $2, $3, 'yes' from app.round_pairings p join app.rounds r on r.id = p.round_id
          where r.event_id = $1 and ((p.woman_id = $2 and p.man_id = $3) or (p.woman_id = $3 and p.man_id = $2))`,
        [event, a, b],
      );
    for (const [a, b] of [[w[0], m[0]], [w[0], m[1]], [w[0], m[2]], [w[0], m[3]], [w[1], m[0]], [w[2], m[0]]] as [string, string][]) {
      await yes(a, b);
      await yes(b, a);
    }
    await db.query("update app.events set status = 'finished' where id = $1", [event]);
  });

  it("w0 a 4 matchs : celui avec m0 (qui en a 3) est retiré ; les autres restent", async () => {
    const [{ n }] = await as<{ n: number }>(admin, "select app.compute_matches($1) as n", [event]);
    expect(n).toBe(5);
    const pairs = (
      await db.query<{ a: string; b: string }>("select member_a as a, member_b as b from app.matches where event_id = $1", [event])
    ).rows.map((r) => [r.a, r.b].sort().join("+"));
    const has = (x: string, y: string) => pairs.includes([x, y].sort().join("+"));
    expect(has(w[0]!, m[0]!)).toBe(false);
    expect([has(w[0]!, m[1]!), has(w[0]!, m[2]!), has(w[0]!, m[3]!), has(w[1]!, m[0]!), has(w[2]!, m[0]!)]).toEqual([true, true, true, true, true]);
    const audit = await one<{ details: { removed: number } }>("select details from app.audit_log where action = 'matches.limited' and target_id = $1", [event]);
    expect(audit.details.removed).toBe(1);
  });

  it("aucun choix : chaque match s'ouvre en discussion, notifié aux deux", async () => {
    const rows = (
      await db.query<{ status: string; discovery: string | null; conversation: string | null }>(
        `select m.status::text, d.id as discovery, c.id as conversation from app.matches m
           left join app.discoveries d on d.match_id = m.id left join app.conversations c on c.discovery_id = d.id
          where m.event_id = $1`,
        [event],
      )
    ).rows;
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.status).toBe("discovery_open");
      expect(r.conversation).not.toBeNull();
    }
    expect(await notices(w[0]!, "discovery.opened")).toHaveLength(3);
    expect(await notices(m[0]!, "discovery.opened")).toHaveLength(2);
  });

  it("liste des discussions : dernier message, non lus, et lu par l'autre", async () => {
    const [chat] = (
      await as<{ conversation_id: string; unread: number; last_body: string | null }>(w[1]!, "select * from app.my_discovery_chats()")
    );
    expect(chat).toMatchObject({ unread: 0, last_body: null });
    await as(m[0]!, "select app.send_message($1, 'Bonsoir, ravi de vous avoir rencontrée.')", [chat!.conversation_id]);
    const [after] = await as<{ unread: number; last_body: string; last_from_me: boolean }>(w[1]!, "select * from app.my_discovery_chats()");
    expect(after).toMatchObject({ unread: 1, last_body: "Bonsoir, ravi de vous avoir rencontrée.", last_from_me: false });
    const [before] = await as<{ at: Date | null }>(m[0]!, "select app.conversation_partner_read_at($1) as at", [chat!.conversation_id]);
    expect(before!.at).toBeNull();
    await as(w[1]!, "select app.mark_conversation_read($1)", [chat!.conversation_id]);
    const [read] = await as<{ at: Date | null }>(m[0]!, "select app.conversation_partner_read_at($1) as at", [chat!.conversation_id]);
    expect(read!.at).not.toBeNull();
    expect(await failure(as(w[3]!, "select app.conversation_partner_read_at($1)", [chat!.conversation_id]))).toMatch(/not_member/);
  });
});

describe("Sujets de débat", () => {
  it("24 sujets ; l'équipe en choisit 4 différents de la liste ; la page de vote les lit par le code QR", async () => {
    expect((await one<{ n: number }>("select count(*)::int as n from app.debate_topics")).n).toBe(24);
    const event = await createEvent(db, { startsInHours: 1, capacityWomen: 1, capacityMen: 1 });
    const topics = ["respect", "forgiveness", "phone_time", "travel_dreams"];
    expect(await failure(as(admin, "select app.set_event_topics($1, $2)", [event, ["respect", "respect", "phone_time", "travel_dreams"]]))).toMatch(
      /invalid_topics/,
    );
    expect(await failure(as(admin, "select app.set_event_topics($1, $2)", [event, ["respect", "inconnu", "phone_time", "travel_dreams"]]))).toMatch(
      /invalid_topics/,
    );
    const member = await createMember(db, { firstName: "Kémi", sex: "female" });
    expect(await failure(as(member, "select app.set_event_topics($1, $2)", [event, topics]))).toMatch(/forbidden/);
    expect(await failure(as(admin, "select app.set_event_topics($1, $2)", [event, topics]))).toBeNull();

    const man = await createMember(db, { firstName: "Codjo", sex: "male" });
    await register(db, event, member, "female", "confirmed");
    await register(db, event, man, "male", "confirmed");
    await as(admin, "select app.prepare_evening($1)", [event]);
    const { qr_token } = await one<{ qr_token: string }>("select qr_token from app.event_tables where event_id = $1", [event]);
    const [{ t }] = await as<{ t: string[] }>(member, "select app.evening_topics_by_qr($1) as t", [qr_token]);
    expect(t).toEqual(topics);
  });
});
