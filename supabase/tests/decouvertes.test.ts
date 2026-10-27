import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createEvent, createMember } from "./fixtures";

/**
 * Découvertes (section 9.4) et ouverture des découvertes (question 2 de la phase 3) :
 * places, choix d'office, choix du membre, ouverture à deux, prolongation unique, couple,
 * fermeture des autres découvertes, attente de 7 jours, message neutre, confidentialité.
 */

let db: PGlite;
let event: string;
const p: Record<string, string> = {};

/** Requête validée au nom d'un membre (la transaction est gardée). */
async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** Tâche système de l'API (clé service role). */
async function asSystem<T>(sql: string): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    await tx.exec("set local role service_role");
    return (await tx.query<T>(sql)).rows;
  });
}

/** Match annoncé (annonce passée, pas encore notifiée) entre deux membres. */
async function match(a: string, b: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into app.matches (event_id, member_a, member_b, announced_at)
     values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now() - interval '1 hour') returning id`,
    [event, a, b],
  );
  return rows[0]!.id;
}

const announce = () => asSystem<{ n: number }>("select app.announce_matches() as n");
const discoveryOf = async (matchId: string) =>
  (await db.query<{ id: string; status: string; extended: boolean; ends_at: Date }>("select * from app.discoveries where match_id = $1", [matchId])).rows[0];
const notices = async (user: string, kind: string) =>
  Number((await db.query<{ n: string }>("select count(*) as n from app.notifications where user_id = $1 and kind = $2", [user, kind])).rows[0]!.n);
const choose = (user: string, matchId: string) => failure(as(user, "select app.choose_match($1)", [matchId]));
const decide = (user: string, discovery: string, cont: boolean, ext: boolean) =>
  as<{ r: string }>(user, "select app.decide_discovery($1, $2, $3) as r", [discovery, cont, ext]).then((r) => r[0]!.r);

beforeAll(async () => {
  db = await createDb();
  for (const [name, sex] of [
    ["afiwa", "female"],
    ["sena", "female"],
    ["ablavi", "female"],
    ["koffi", "male"],
    ["dossou", "male"],
    ["yao", "male"],
    ["kodjo", "male"],
  ] as const) {
    p[name] = await createMember(db, { firstName: name[0]!.toUpperCase() + name.slice(1), sex });
  }
  event = await createEvent(db, { startsInHours: -24, status: "finished" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Découvertes (9.4, question 2)", () => {
  let first: string;
  let firstDiscovery: string;

  it("annonce : les matchs qui tiennent dans les places sont choisis d'office et s'ouvrent", async () => {
    first = await match(p.afiwa!, p.koffi!);
    await announce();
    const d = await discoveryOf(first);
    expect(d?.status).toBe("active");
    firstDiscovery = d!.id;
    expect(await notices(p.afiwa!, "discovery.opened")).toBe(1);
    expect(await notices(p.koffi!, "discovery.opened")).toBe(1);
    const { rows } = await db.query("select * from app.conversations where discovery_id = $1 and kind = 'discovery'", [firstDiscovery]);
    expect(rows).toHaveLength(1);
    // 14 jours
    const days = (d!.ends_at.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
  });

  let m2: string;
  let m3: string;
  it("trop de nouveaux matchs pour les places : le membre choisit, dans la limite de ses places", async () => {
    m2 = await match(p.afiwa!, p.dossou!);
    m3 = await match(p.afiwa!, p.yao!);
    await announce();
    // Afiwa : 2 nouveaux matchs pour 1 place, aucun choix d'office ; Dossou et Yao : choisis d'office
    expect(await discoveryOf(m2)).toBeUndefined();
    const mine = await as<{ match_id: string; chosen_by_me: boolean; free_slots: number }>(p.afiwa!, "select * from app.my_discoveries()");
    expect(mine.find((r) => r.match_id === m2)?.chosen_by_me).toBe(false);
    expect(mine[0]!.free_slots).toBe(1);
    expect(await choose(p.afiwa!, m2)).toBeNull();
    expect((await discoveryOf(m2))?.status).toBe("active");
    expect(await choose(p.afiwa!, m3)).toMatch(/no_free_slot/);
    expect(await choose(p.afiwa!, m2)).toMatch(/not_pending/);
    expect(await choose(p.sena!, m3)).toMatch(/not_member/);
  });

  it("confidentialité : personne ne voit le choix ni la décision de l'autre", async () => {
    await decide(p.afiwa!, firstDiscovery, true, false);
    const seenByKoffi = await as<{ user_id: string }>(p.koffi!, "select user_id from app.discovery_decisions union all select user_id from app.match_choices where user_id <> $1", [p.koffi]);
    expect(seenByKoffi.filter((r) => r.user_id !== p.koffi)).toEqual([]);
    const [row] = (await as<{ i_want_to_continue: boolean; discovery_id: string }>(p.koffi!, "select * from app.my_discoveries()")).filter(
      (r) => r.discovery_id === firstDiscovery,
    );
    expect(row?.i_want_to_continue).toBe(false);
    expect(await failure(as(p.sena!, "select app.decide_discovery($1, true, false)", [firstDiscovery]))).toMatch(/not_member/);
    const others = await as(p.sena!, "select * from app.discoveries");
    expect(others).toEqual([]);
  });

  it("prolongation : seulement si les deux la demandent, une seule fois, 7 jours", async () => {
    // Question 3 : la demande n'est possible que pendant les 4 derniers jours
    expect(await failure(as(p.afiwa!, "select app.decide_discovery($1, false, true)", [(await discoveryOf(m2))!.id]))).toMatch(/extension_too_early/);
    await db.query("update app.discoveries set ends_at = now() + interval '3 days' where match_id = $1", [m2]);
    const d2 = (await discoveryOf(m2))!;
    expect(await decide(p.afiwa!, d2.id, false, true)).toBe("recorded");
    expect(await decide(p.dossou!, d2.id, false, true)).toBe("extended");
    const after = (await discoveryOf(m2))!;
    expect(after.status).toBe("extended");
    expect(after.ends_at.getTime() - d2.ends_at.getTime()).toBe(7 * 86_400_000);
    // Une seule fois : une nouvelle demande est refusée
    expect(await failure(as(p.afiwa!, "select app.decide_discovery($1, false, true)", [d2.id]))).toMatch(/already_extended/);
    expect((await discoveryOf(m2))!.ends_at.getTime()).toBe(after.ends_at.getTime());
  });

  it("les deux veulent continuer : couple, autres découvertes des deux fermées, message neutre", async () => {
    // Koffi a une autre découverte, avec Ablavi
    const mk = await match(p.ablavi!, p.koffi!);
    await announce();
    expect((await discoveryOf(mk))?.status).toBe("active");
    expect(await decide(p.koffi!, firstDiscovery, true, false)).toBe("couple");
    const { rows: couples } = await db.query<{ id: string; status: string }>("select * from app.couples where discovery_id = $1", [firstDiscovery]);
    expect(couples[0]?.status).toBe("active");
    expect((await discoveryOf(first))?.status).toBe("continued");
    expect((await discoveryOf(m2))?.status).toBe("closed"); // Afiwa et Dossou
    expect((await discoveryOf(mk))?.status).toBe("closed"); // Koffi et Ablavi
    expect(await notices(p.dossou!, "discovery.closed")).toBe(1);
    expect(await notices(p.ablavi!, "discovery.closed")).toBe(1);
    const { rows: closedChats } = await db.query("select * from app.conversations c join app.discoveries d on d.id = c.discovery_id where d.match_id = $1 and c.closed_at is not null", [mk]);
    expect(closedChats).toHaveLength(1);
    const { rows: coupleChat } = await db.query("select * from app.conversations where couple_id = $1 and kind = 'couple'", [couples[0]!.id]);
    expect(coupleChat).toHaveLength(1);
    // Question 13 : les matchs encore en attente des deux expirent aussitôt, message neutre
    expect(await choose(p.afiwa!, m3)).toMatch(/not_pending/);
    expect((await db.query<{ status: string }>("select status from app.matches where id = $1", [m3])).rows[0]?.status).toBe("expired");
    expect(await notices(p.yao!, "match.expired")).toBe(1);
    // Exclusivité : plus de réservation
    const soon = await createEvent(db, { startsInHours: 120 });
    expect(await failure(as(p.afiwa!, "select app.book_event($1)", [soon]))).toMatch(/couple_exclusivity/);
  });

  it("échéance : découverte fermée, match non ouvert expiré à 7 jours, message neutre aux deux", async () => {
    const md = await match(p.sena!, p.kodjo!);
    await announce();
    const d = (await discoveryOf(md))!;
    await db.query("update app.discoveries set ends_at = now() - interval '1 minute' where id = $1", [d.id]);
    // Match annoncé jamais ouvert (Ablavi et Yao) : son attente de 7 jours se termine
    const { rows: pending } = await db.query<{ id: string }>(
      `insert into app.matches (event_id, member_a, member_b, announced_at, notified_at, pending_expires_at)
       values ($1, least($2::uuid, $3::uuid), greatest($2::uuid, $3::uuid), now() - interval '8 days', now() - interval '8 days', now() - interval '1 minute')
       returning id`,
      [event, p.ablavi, p.yao],
    );
    const mp = pending[0]!.id;
    const [{ n }] = await asSystem<{ n: number }>("select app.expire_discoveries() as n");
    expect(n).toBeGreaterThanOrEqual(2);
    expect((await discoveryOf(md))?.status).toBe("expired");
    expect(await notices(p.kodjo!, "discovery.closed")).toBe(1);
    const { rows } = await db.query<{ status: string }>("select status from app.matches where id = $1", [mp]);
    expect(rows[0]?.status).toBe("expired");
    expect(await notices(p.ablavi!, "match.expired")).toBe(1);
    expect(await notices(p.yao!, "match.expired")).toBe(2);
    expect(await choose(p.yao!, mp)).toMatch(/not_pending/);
  });

  it("tâche système réservée : un membre ne peut ni fermer ni expirer", async () => {
    expect(await failure(as(p.sena!, "select app.expire_discoveries()"))).toMatch(/forbidden/);
    expect(await failure(as(p.sena!, "select app.close_discovery($1, 'closed')", [firstDiscovery]))).toMatch(/permission denied/);
    const viaTeam = await asUser(db, p.sena!, (tx) => failure(tx.query("select app.try_open_discovery($1)", [m3])));
    expect(viaTeam).toMatch(/permission denied/);
  });
});
