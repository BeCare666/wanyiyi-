import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

let db: PGlite;
let afiwa: string; // membre validée
let sena: string; // membre validée
let koffi: string; // membre validé
let nadege: string; // membre en attente de vérification
let admin: string;
let moderator: string;

beforeAll(async () => {
  db = await createDb();
  afiwa = await createMember(db, { firstName: "Afiwa", sex: "female", religion: "catholic", sector: "health" });
  sena = await createMember(db, { firstName: "Séna", sex: "female" });
  koffi = await createMember(db, { firstName: "Koffi", sex: "male" });
  nadege = await createMember(db, { firstName: "Nadège", sex: "female", status: "pending_verification" });
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  moderator = await createMember(db, { firstName: "Gildas", sex: "male", role: "moderator" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const rows = async <T>(p: Promise<{ rows: T[] }>) => (await p).rows;

describe("Comptes et profils (RLS)", () => {
  it("un visiteur n'a aucun accès au schéma app", async () => {
    expect(await asAnon(db, (tx) => failure(tx.query("select * from app.member_profiles")))).toMatch(/permission denied/);
  });

  it("un membre ne lit que son propre profil, l'équipe lit tous les profils", async () => {
    const own = await asUser(db, afiwa, (tx) => rows(tx.query<{ first_name: string }>("select first_name from app.member_profiles")));
    expect(own.map((r) => r.first_name)).toEqual(["Afiwa"]);
    const team = await asUser(db, moderator, (tx) => rows(tx.query("select 1 from app.member_profiles")));
    expect(team.length).toBe(6);
  });

  it("un compte reçoit un numéro de membre à sa création", async () => {
    const [user] = await rows(db.query<{ member_number: string }>("select member_number from app.users where id = $1", [afiwa]));
    expect(user?.member_number).toMatch(/^W\d{6}$/);
  });

  it("un membre ne peut ni se valider lui-même, ni changer son sexe ou sa date de naissance, ni son rôle", async () => {
    expect(await asUser(db, nadege, (tx) => failure(tx.query("update app.member_profiles set status = 'verified' where user_id = $1", [nadege])))).toMatch(
      /forbidden_column/,
    );
    expect(await asUser(db, nadege, (tx) => failure(tx.query("update app.member_profiles set birth_date = '2000-01-01' where user_id = $1", [nadege])))).toMatch(
      /forbidden_column/,
    );
    expect(await asUser(db, nadege, (tx) => failure(tx.query("update app.users set role = 'admin' where id = $1", [nadege])))).toMatch(/forbidden_column/);
    // Modifier sa ville reste possible
    expect(await asUser(db, nadege, (tx) => failure(tx.query("update app.member_profiles set city = 'Porto-Novo' where user_id = $1", [nadege])))).toBeNull();
  });

  it("un texte de profil modifié par le membre repasse en relecture", async () => {
    const status = await asUser(db, afiwa, async (tx) => {
      await tx.query("insert into app.profile_texts (user_id, field, body, review_status) values ($1, 'who_i_am', 'Calme et souriante.', 'approved')", [afiwa]);
      return rows(tx.query<{ review_status: string }>("select review_status from app.profile_texts where user_id = $1", [afiwa]));
    });
    expect(status[0]?.review_status).toBe("pending");
  });

  it("au maximum 3 critères non négociables", async () => {
    const error = await asUser(db, afiwa, (tx) =>
      failure(tx.query("insert into app.dealbreakers (user_id, category) values ($1, 'religion'), ($1, 'tobacco'), ($1, 'children'), ($1, 'alcohol')", [afiwa])),
    );
    expect(error).toMatch(/Au maximum 3/);
  });
});

describe("Écritures directes interdites aux membres", () => {
  it("un membre ne peut contourner aucune fonction métier", async () => {
    const event = await createEvent(db, { startsInHours: 120 });
    const attempts = await asUser(db, afiwa, async (tx) => {
      const attempt = async (sql: string, params: unknown[]) => {
        await tx.exec("savepoint essai");
        const error = await failure(tx.query(sql, params));
        await tx.exec("rollback to savepoint essai");
        return error;
      };
      return {
        registration: await attempt("insert into app.event_registrations (event_id, user_id, sex, status) values ($1, $2, 'female', 'confirmed')", [event, afiwa]),
        waitlist: await attempt("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'female', 0)", [event, afiwa]),
        match: await attempt("insert into app.matches (event_id, member_a, member_b, announced_at) values ($1, $2, $3, now())", [event, ...[afiwa, koffi].sort()]),
        payment: await attempt("insert into app.payments (user_id, purpose, amount_xof, status) values ($1, 'evening_booking', 1000, 'succeeded')", [afiwa]),
        // Une mise à jour filtrée par la RLS ne lève pas d'erreur : elle ne touche aucune ligne
        eventRows: (await tx.query("update app.events set capacity_women = 12 where id = $1 returning id", [event])).rows.length,
        settingsRows: (await tx.query("update app.settings set value = '1' where key = 'evenings.confirmation_hours_before' returning key")).rows
          .length,
      };
    });
    const { eventRows, settingsRows, ...inserts } = attempts;
    for (const [what, error] of Object.entries(inserts)) {
      expect(error, what).toMatch(/row-level security|violates|permission denied/);
    }
    expect(eventRows).toBe(0);
    expect(settingsRows).toBe(0);
  });

  it("un nouveau profil créé par le membre démarre toujours en « inscription » ; plus d'écriture directe (19 octobre 2026)", async () => {
    const id = await createMember(db, { firstName: "Bienvenu", sex: "male" });
    await db.query("delete from app.member_profiles where user_id = $1", [id]);
    const result = await asUser(db, id, async (tx) => {
      await tx.exec("savepoint direct");
      const direct = await failure(
        tx.query(
          "insert into app.member_profiles (user_id, first_name, last_name, sex, birth_date, status) values ($1, 'Bienvenu', 'Fictif', 'male', '1990-01-01', 'verified')",
          [id],
        ),
      );
      await tx.exec("rollback to savepoint direct");
      await tx.query("select app.complete_registration('Bienvenu', 'Fictif', 'male', '1990-01-01', 'Cotonou', true)");
      return { direct, status: await rows(tx.query<{ status: string }>("select status from app.member_profiles where user_id = $1", [id])) };
    });
    expect(result.direct).toMatch(/row-level security/);
    expect(result.status[0]?.status).toBe("registering");
  });
});

describe("Vérification et pièces d'identité (10.1)", () => {
  it("le membre dépose son selfie mais ne peut jamais le relire", async () => {
    const readBack = await asUser(db, nadege, async (tx) => {
      await tx.query("insert into storage.objects (bucket_id, name) values ('id-documents', $1)", [`${nadege}/selfie.jpg`]);
      await tx.query("select app.submit_selfie($1)", [`${nadege}/selfie.jpg`]);
      return {
        documents: await rows(tx.query("select * from app.id_documents")),
        files: await rows(tx.query("select * from storage.objects")),
      };
    });
    expect(readBack).toEqual({ documents: [], files: [] });
  });

  it("l'équipe de vérification consulte une pièce par une fonction qui journalise chaque consultation", async () => {
    const [v] = await rows(db.query<{ id: string }>("insert into app.verifications (user_id) values ($1) returning id", [nadege]));
    const [d] = await rows(
      db.query<{ id: string }>(
        "insert into app.id_documents (verification_id, kind, storage_path) values ($1, 'passport', 'id-documents/p.jpg') returning id",
        [v!.id],
      ),
    );
    expect(await asUser(db, moderator, (tx) => failure(tx.query("select app.open_id_document($1)", [d!.id])))).toMatch(/forbidden/);
    expect(await asUser(db, admin, (tx) => failure(tx.query("select * from app.id_documents")))).toBeNull();

    const result = await asUser(db, admin, async (tx) => {
      const [opened] = await rows(tx.query<{ path: string }>("select app.open_id_document($1) as path", [d!.id]));
      // Lecture directe impossible, même pour l'administration
      const direct = await rows(tx.query("select * from app.id_documents where id = $1", [d!.id]));
      // Le journal n'est lisible que par la super administration : contrôle en accès base
      await tx.exec("reset role");
      const logs = await rows(tx.query<{ action: string; actor_id: string }>("select action, actor_id from app.audit_log where target_id = $1", [d!.id]));
      return { path: opened?.path, direct, logs };
    });
    expect(result.path).toBe("id-documents/p.jpg");
    expect(result.direct).toEqual([]);
    expect(result.logs).toEqual([{ action: "id_document.viewed", actor_id: admin }]);
  });

  it("la validation par l'équipe rend le membre « vérifié » ; un modérateur ne peut pas valider", async () => {
    const [v] = await rows(db.query<{ id: string }>("insert into app.verifications (user_id) values ($1) returning id", [nadege]));
    const decide = (who: string) =>
      asUser(db, who, (tx) => failure(tx.query("select app.decide_verification($1, 'approved', null)", [v!.id])));
    expect(await decide(moderator)).toMatch(/forbidden/);
    // Dossier encore vide : pas de validation possible
    expect(await decide(admin)).toMatch(/dossier_incomplete/);

    await db.query(
      `insert into app.id_documents (verification_id, kind, part, storage_path)
       values ($1, 'passport', 'photo_page', 'n/p.jpg'), ($1, 'selfie', 'face', 'n/s.jpg')`,
      [v!.id],
    );
    await db.query("insert into app.honor_declarations (user_id, declared_marital_status, has_children, text_version) values ($1, 'single', false, 'v1')", [
      nadege,
    ]);
    const byAdmin = await asUser(db, admin, async (tx) => {
      // Écriture directe retirée : seule la fonction décide
      const direct = (await tx.query("update app.verifications set status = 'approved' where id = $1 returning id", [v!.id])).rows.length;
      await tx.query("select app.decide_verification($1, 'approved', null)", [v!.id]);
      const [profile] = await rows(
        tx.query<{ status: string; journey_stage: string }>("select status, journey_stage from app.member_profiles where user_id = $1", [nadege]),
      );
      return { direct, profile };
    });
    expect(byAdmin).toEqual({ direct: 0, profile: { status: "verified", journey_stage: "evenings" } });
  });
});

describe("Réservation des soirées (9.2)", () => {
  it("seuls les membres validés réservent", async () => {
    const event = await createEvent(db, { startsInHours: 120 });
    expect(await asUser(db, nadege, (tx) => failure(tx.query("select app.book_event($1)", [event])))).toMatch(/not_validated/);
    const outcome = await asUser(db, afiwa, (tx) => rows(tx.query<{ o: string }>("select app.book_event($1) as o", [event])));
    expect(outcome[0]?.o).toBe("seat");
  });

  it("quotas séparés par sexe et liste d'attente par sexe", async () => {
    const event = await createEvent(db, { startsInHours: 120, capacityWomen: 1, capacityMen: 1 });
    await register(db, event, sena, "female", "booked");
    const result = await asUser(db, afiwa, async (tx) => {
      const [o] = await rows(tx.query<{ o: string }>("select app.book_event($1) as o", [event]));
      const seats = await rows(tx.query<{ sex: string; taken: number; waiting: number }>("select sex, taken, waiting from app.event_seats($1)", [event]));
      return { outcome: o?.o, seats };
    });
    expect(result.outcome).toBe("waitlist");
    expect(result.seats).toEqual([
      { sex: "female", taken: 1, waiting: 1 },
      { sex: "male", taken: 0, waiting: 0 },
    ]);
    const male = await asUser(db, koffi, (tx) => rows(tx.query<{ o: string }>("select app.book_event($1) as o", [event])));
    expect(male[0]?.o).toBe("seat");
  });

  it("refuse une double inscription, une soirée commencée ou en brouillon, et l'exclusivité du couple", async () => {
    const event = await createEvent(db, { startsInHours: 120 });
    await register(db, event, afiwa, "female", "booked");
    expect(await asUser(db, afiwa, (tx) => failure(tx.query("select app.book_event($1)", [event])))).toMatch(/already_registered/);
    const started = await createEvent(db, { startsInHours: -1 });
    expect(await asUser(db, sena, (tx) => failure(tx.query("select app.book_event($1)", [started])))).toMatch(/evening_closed/);
    const draft = await createEvent(db, { startsInHours: 120, status: "draft" });
    expect(await asUser(db, sena, (tx) => failure(tx.query("select app.book_event($1)", [draft])))).toMatch(/evening_closed/);

    const [a, b] = [sena, koffi].sort();
    const couple = await rows(db.query<{ id: string }>("insert into app.couples (member_a, member_b) values ($1, $2) returning id", [a, b]));
    const other = await createEvent(db, { startsInHours: 120 });
    expect(await asUser(db, sena, (tx) => failure(tx.query("select app.book_event($1)", [other])))).toMatch(/couple_exclusivity/);
    await db.query("delete from app.couples where id = $1", [couple[0]!.id]);
  });

  it("soirées thématiques : âge le jour de la soirée, foi, secteur", async () => {
    const age = await createEvent(db, { startsInHours: 120, theme: { minAge: 40, maxAge: 55 } });
    expect(await asUser(db, afiwa, (tx) => failure(tx.query("select app.book_event($1)", [age])))).toMatch(/theme_age/);
    const faith = await createEvent(db, { startsInHours: 120, theme: { religions: ["muslim"] } });
    expect(await asUser(db, afiwa, (tx) => failure(tx.query("select app.book_event($1)", [faith])))).toMatch(/theme_religion/);
    const ok = await createEvent(db, { startsInHours: 120, theme: { minAge: 25, maxAge: 40, religions: ["catholic"], sectors: ["health"] } });
    expect(await asUser(db, afiwa, (tx) => failure(tx.query("select app.book_event($1)", [ok])))).toBeNull();
    const sector = await createEvent(db, { startsInHours: 120, theme: { sectors: ["education"] } });
    expect(await asUser(db, afiwa, (tx) => failure(tx.query("select app.book_event($1)", [sector])))).toMatch(/theme_sector/);
  });

  it("l'adresse du lieu n'est visible qu'une fois la place confirmée", async () => {
    const event = await createEvent(db, { startsInHours: 120 });
    await register(db, event, afiwa, "female", "booked");
    const venue = (status: string) =>
      asUser(db, afiwa, async (tx) => {
        await tx.exec("reset role");
        await tx.query("update app.event_registrations set status = $2 where event_id = $1", [event, status]);
        await tx.exec("set local role authenticated");
        return rows(tx.query("select v.address from app.venues v join app.events e on e.venue_id = v.id where e.id = $1", [event]));
      });
    expect(await venue("booked")).toEqual([]);
    expect(await venue("confirmed")).toHaveLength(1);
  });
});

describe("Confirmation 48 h avant et liste d'attente (9.2)", () => {
  it("confirmation possible avant la limite, refusée après", async () => {
    const early = await createEvent(db, { startsInHours: 72 });
    await register(db, early, afiwa, "female", "booked");
    expect(await asUser(db, afiwa, (tx) => failure(tx.query("select app.confirm_registration($1)", [early])))).toBeNull();
    const late = await createEvent(db, { startsInHours: 47 });
    await register(db, late, afiwa, "female", "booked");
    expect(await asUser(db, afiwa, (tx) => failure(tx.query("select app.confirm_registration($1)", [late])))).toMatch(/confirmation_closed/);
  });

  it("sans confirmation à la limite, la place passe au premier de la liste d'attente du même sexe", async () => {
    const event = await createEvent(db, { startsInHours: 40, capacityWomen: 1, capacityMen: 1 });
    await register(db, event, sena, "female", "booked", 30); // place attribuée avant la limite, non confirmée
    await register(db, event, koffi, "male", "confirmed", 30);
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'female', 1)", [event, afiwa]);

    expect(await asUser(db, afiwa, (tx) => failure(tx.query("select app.release_unconfirmed($1)", [event])))).toMatch(/forbidden/);
    const after = await asService(db, async (tx) => {
      await tx.query("select app.release_unconfirmed($1)", [event]);
      return rows(tx.query<{ first_name: string; status: string }>(
        `select p.first_name, r.status from app.event_registrations r join app.member_profiles p on p.user_id = r.user_id
         where r.event_id = $1 order by p.first_name`, [event]));
    });
    expect(after).toEqual([
      { first_name: "Afiwa", status: "booked" },
      { first_name: "Koffi", status: "confirmed" },
      { first_name: "Séna", status: "released" },
    ]);
  });

  it("une annulation libère la place pour le premier en attente et le prévient", async () => {
    const event = await createEvent(db, { startsInHours: 120, capacityWomen: 1 });
    await register(db, event, sena, "female", "confirmed");
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'female', 1)", [event, afiwa]);
    const result = await asUser(db, sena, async (tx) => {
      await tx.query("select app.cancel_registration($1)", [event]);
      await tx.exec("reset role");
      return {
        regs: await rows(tx.query<{ user_id: string; status: string }>("select user_id, status from app.event_registrations where event_id = $1 order by status", [event])),
        notif: await rows(tx.query<{ kind: string }>("select kind from app.notifications where user_id = $1", [afiwa])),
      };
    });
    expect(result.regs).toEqual([
      { user_id: afiwa, status: "booked" },
      { user_id: sena, status: "cancelled" },
    ]);
    expect(result.notif.map((n) => n.kind)).toContain("evening.seat_offered");
  });
});

describe("Rotation, vote QR et matchs (9.2, 9.3)", () => {
  /** Soirée commencée il y a 10 minutes : 3 femmes, 2 hommes pointés. */
  async function startedEvening() {
    const women = [afiwa, sena, await createMember(db, { firstName: "Mariam", sex: "female" })];
    const men = [koffi, await createMember(db, { firstName: "Dossou", sex: "male" })];
    const event = await createEvent(db, { startsInHours: -10 / 60 });
    for (const w of women) await register(db, event, w, "female", "checked_in");
    for (const m of men) await register(db, event, m, "male", "checked_in");
    return { event, women, men };
  }

  it("la préparation crée N tables, N tours et la rotation de la note, tours de pause compris", async () => {
    const { event, women, men } = await startedEvening();
    const result = await asUser(db, admin, async (tx) => {
      const [n] = await rows(tx.query<{ n: number }>("select app.prepare_evening($1) as n", [event]));
      const pairings = await rows(
        tx.query<{ round_number: number; table_number: number; woman_id: string | null; man_id: string | null }>(
          `select r.round_number, t.table_number, p.woman_id, p.man_id from app.round_pairings p
           join app.rounds r on r.id = p.round_id join app.event_tables t on t.id = p.table_id
           where r.event_id = $1 order by 1, 2`, [event]),
      );
      return { n: n?.n, pairings };
    });
    expect(result.n).toBe(3);
    expect(result.pairings).toHaveLength(9);
    const meetings = result.pairings.filter((p) => p.woman_id && p.man_id).map((p) => `${p.woman_id}-${p.man_id}`);
    expect(new Set(meetings).size).toBe(6); // 3 femmes × 2 hommes, chacun une fois
    // Les femmes ne bougent pas
    expect(result.pairings.every((p) => p.woman_id === women[p.table_number - 1])).toBe(true);
    // Tour 1 : l'homme n° m à la table m (ordre de pointage)
    expect(result.pairings.filter((p) => p.round_number === 1).map((p) => p.man_id)).toEqual([men[0], men[1], null]);
  });

  it("vote pendant la soirée seulement, modifiable jusqu'à la fin, match si double oui annoncé le lendemain à 8 h", async () => {
    const { event, women, men } = await startedEvening();
    const outcome = await asUser(db, admin, async (tx) => {
      await tx.query("select app.prepare_evening($1)", [event]);
      await tx.query("select app.start_evening($1)", [event]);
      const [{ qr }] = (await rows(tx.query<{ qr: string }>("select qr_token as qr from app.event_tables where event_id = $1 and table_number = 1", [event]))) as [{ qr: string }];

      const as = async (user: string, sql: string, params: unknown[]) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
        return tx.query(sql, params);
      };
      // Tour 1 : Afiwa (table 1) et Koffi (homme n° 1)
      const partner = await as(women[0]!, "select first_name, table_number from app.round_partner($1, 1::smallint)", [qr]);
      await as(women[0]!, "select app.cast_vote($1, 1::smallint, 'no')", [qr]);
      await as(women[0]!, "select app.cast_vote($1, 1::smallint, 'yes', 5::smallint)", [qr]); // modifié
      await as(men[0]!, "select app.cast_vote($1, 1::smallint, 'yes')", [qr]);
      // Tour 1 : Séna (table 2) dit oui à Dossou, Dossou dit non
      await as(women[1]!, "select app.cast_vote($1, 1::smallint, 'yes')", [qr]);
      await as(men[1]!, "select app.cast_vote($1, 1::smallint, 'no')", [qr]);
      // Erreur attendue isolée dans un point de sauvegarde : la transaction de test continue
      const expectFailure = async (run: () => Promise<unknown>) => {
        await tx.exec("savepoint attendu");
        const error = await failure(run());
        await tx.exec("rollback to savepoint attendu");
        return error;
      };
      // Tour 1 : Mariam (table 3) est en pause
      const pause = await expectFailure(() => as(women[2]!, "select app.cast_vote($1, 1::smallint, 'yes')", [qr]));
      // Un membre ne voit que ses propres votes
      const seenByKoffi = await as(men[0]!, "select voter_id from app.votes", []);
      const feedbackByKoffi = await as(men[0]!, "select * from app.vote_feedback", []);
      // Page de vote : les tours d'Afiwa (pause au tour 2), sans aucun prénom
      const roundsAfiwa = await as(women[0]!, "select * from app.my_evening_rounds($1)", [qr]);
      const outsider = await expectFailure(() => as(admin, "select * from app.my_evening_rounds($1)", [qr]));

      await as(admin, "select app.finish_evening($1)", [event]);
      const late = await expectFailure(() => as(women[0]!, "select app.cast_vote($1, 1::smallint, 'no')", [qr]));
      const lateRounds = await expectFailure(() => as(women[0]!, "select * from app.my_evening_rounds($1)", [qr]));
      await as(admin, "select app.compute_matches($1)", [event]);
      const before = await as(women[0]!, "select partner_first_name from app.my_matches()", []);
      await tx.exec("reset role");
      const all = await tx.query<{ member_a: string; member_b: string; announced_at: Date }>("select member_a, member_b, announced_at from app.matches where event_id = $1", [event]);
      const [{ expected }] = (await tx.query<{ expected: Date }>("select app.match_announcement_at(starts_at) as expected from app.events where id = $1", [event])).rows as [{ expected: Date }];
      return { partner: partner.rows, roundsAfiwa: roundsAfiwa.rows, outsider, lateRounds, pause, seenByKoffi: seenByKoffi.rows, feedbackByKoffi: feedbackByKoffi.rows, late, before: before.rows, all: all.rows, expected };
    });

    // Afiwa voit le prénom de la personne rencontrée au tour 1, jamais son nom de famille
    expect(outcome.partner).toEqual([{ first_name: "Koffi", table_number: 1 }]);
    expect(outcome.pause).toMatch(/pause_round/);
    expect(outcome.roundsAfiwa).toEqual([
      { round_number: 1, is_pause: false, my_choice: "yes" },
      { round_number: 2, is_pause: true, my_choice: null },
      { round_number: 3, is_pause: false, my_choice: null },
    ]);
    expect(outcome.outsider).toMatch(/not_in_round/);
    expect(outcome.lateRounds).toMatch(/outside_evening/);
    expect(outcome.seenByKoffi).toEqual([{ voter_id: men[0] }]);
    expect(outcome.feedbackByKoffi).toEqual([]);
    expect(outcome.late).toMatch(/outside_evening/);
    // Un seul match : Afiwa et Koffi. Séna/Dossou : pas de match, et personne ne voit le « non »
    expect(outcome.all).toHaveLength(1);
    expect([outcome.all[0]!.member_a, outcome.all[0]!.member_b].sort()).toEqual([women[0], men[0]].sort());
    expect(new Date(outcome.all[0]!.announced_at).getTime()).toBe(new Date(outcome.expected).getTime());
    // Avant 8 h le lendemain, le match n'est pas visible
    expect(outcome.before).toEqual([]);
  });

  it("l'annonce de 8 h crée une notification par membre concerné, une seule fois", async () => {
    const [a, b] = [afiwa, koffi].sort();
    const event = await createEvent(db, { startsInHours: -30, status: "finished" });
    await db.query("insert into app.matches (event_id, member_a, member_b, announced_at) values ($1, $2, $3, now() - interval '1 minute')", [event, a, b]);
    const result = await asService(db, async (tx) => {
      const [first] = (await tx.query<{ n: number }>("select app.announce_matches() as n")).rows;
      const [second] = (await tx.query<{ n: number }>("select app.announce_matches() as n")).rows;
      return { first: first?.n, second: second?.n };
    });
    expect(result).toEqual({ first: 2, second: 0 });
    const visible = await asUser(db, afiwa, (tx) => rows(tx.query<{ partner_first_name: string }>("select partner_first_name from app.my_matches()")));
    expect(visible.map((m) => m.partner_first_name)).toContain("Koffi");
  });
});

describe("Mes soirées dans l'espace membre (6.2-4)", () => {
  type Booking = { event_id: string; status: string; waitlist_rank: number | null; confirm_by: string; paid: boolean };
  const mine = (user: string, events: string[]) =>
    asUser(db, user, (tx) =>
      rows(tx.query<Booking>("select * from app.my_bookings() where event_id = any($1::uuid[]) order by status", [events])),
    );

  it("situation par soirée, rang dans la liste d'attente du même sexe et limite de confirmation", async () => {
    const full = await createEvent(db, { startsInHours: 120, capacityWomen: 1 });
    await register(db, full, sena, "female", "confirmed");
    const waiting = await createMember(db, { firstName: "Houéfa", sex: "female" });
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'female', 1), ($1, $3, 'female', 2)", [
      full,
      waiting,
      afiwa,
    ]);
    const booked = await createEvent(db, { startsInHours: 72 });
    await register(db, booked, afiwa, "female", "booked");

    const result = await mine(afiwa, [full, booked]);
    expect(result.map(({ event_id, status, waitlist_rank, paid }) => ({ event_id, status, waitlist_rank, paid }))).toEqual([
      { event_id: booked, status: "booked", waitlist_rank: null, paid: false },
      { event_id: full, status: "waitlisted", waitlist_rank: 2, paid: false },
    ]);
    // Limite par défaut : 48 h avant le début
    const [event] = await rows(db.query<{ starts_at: string }>("select starts_at from app.events where id = $1", [booked]));
    const bookedRow = result.find((r) => r.event_id === booked)!;
    expect(new Date(event!.starts_at).getTime() - new Date(bookedRow.confirm_by).getTime()).toBe(48 * 3600 * 1000);
  });

  it("chacun ne voit que ses inscriptions ; les soirées annulées par le membre, passées ou en brouillon n'apparaissent pas", async () => {
    const event = await createEvent(db, { startsInHours: 120 });
    await register(db, event, afiwa, "female", "cancelled");
    await register(db, event, koffi, "male", "booked");
    const past = await createEvent(db, { startsInHours: -30, status: "finished" });
    await register(db, past, afiwa, "female", "checked_in");
    expect(await mine(afiwa, [event, past])).toEqual([]);
    expect((await mine(koffi, [event])).map((r) => r.status)).toEqual(["booked"]);
  });

  it("une place libérée puis un retour en liste d'attente ne donnent qu'une ligne ; le paiement réussi est signalé", async () => {
    const event = await createEvent(db, { startsInHours: 120, capacityWomen: 1 });
    await register(db, event, afiwa, "female", "released");
    await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'female', 1)", [event, afiwa]);
    expect((await mine(afiwa, [event])).map((r) => r.status)).toEqual(["waitlisted"]);

    const paidEvent = await createEvent(db, { startsInHours: 120 });
    await register(db, paidEvent, koffi, "male", "booked");
    await db.query(
      `with p as (insert into app.payments (user_id, purpose, amount_xof, provider, status)
                  values ($1, 'evening_booking', 1, 'simulated', 'succeeded') returning id)
       update app.event_registrations set payment_id = (select id from p) where event_id = $2 and user_id = $1`,
      [koffi, paidEvent],
    );
    expect((await mine(koffi, [paidEvent]))[0]?.paid).toBe(true);
  });
});

describe("Notifications du membre", () => {
  it("le membre marque ses notifications comme lues par la fonction, jamais par une écriture directe", async () => {
    const member = await createMember(db, { firstName: "Mahougnon", sex: "female" });
    const other = await createMember(db, { firstName: "Codjo", sex: "male" });
    const ids = await rows(
      db.query<{ id: string }>(
        `insert into app.notifications (user_id, kind) values ($1, 'evening.seat_offered'), ($1, 'match.announced'), ($2, 'match.announced')
         returning id`,
        [member, other],
      ),
    );
    const [first, second, foreign] = ids.map((r) => r.id);

    const result = await asUser(db, member, async (tx) => {
      await tx.exec("savepoint essai");
      const direct = await failure(tx.query("update app.notifications set kind = 'autre' where id = $1", [first]));
      await tx.exec("rollback to savepoint essai");
      const one = await rows(tx.query<{ n: number }>("select app.mark_notifications_read($1::uuid[]) as n", [[first, foreign]]));
      const again = await rows(tx.query<{ n: number }>("select app.mark_notifications_read($1::uuid[]) as n", [[first]]));
      const all = await rows(tx.query<{ n: number }>("select app.mark_notifications_read() as n"));
      // État lu dans la même transaction (elle est annulée à la fin du test)
      await tx.exec("reset role");
      const state = await rows(
        tx.query<{ id: string; read: boolean; kind: string }>("select id, read_at is not null as read, kind from app.notifications where id = any($1::uuid[])", [
          [first, second, foreign],
        ]),
      );
      return { direct, one: one[0]?.n, again: again[0]?.n, all: all[0]?.n, state };
    });
    expect(result.direct).toMatch(/permission denied/);
    // La notification d'un autre membre n'est jamais touchée
    expect(result).toMatchObject({ one: 1, again: 0, all: 1 });
    const { state } = result;
    expect(Object.fromEntries(state.map((s) => [s.id, s.read]))).toEqual({ [first!]: true, [second!]: true, [foreign!]: false });
    expect(state.find((s) => s.id === first)?.kind).toBe("evening.seat_offered");
  });
});

describe("Paramètres du membre (6.2-9)", () => {
  it("le membre change sa langue, son mode sombre et ses canaux de notification, pas ceux d'un autre", async () => {
    const member = await createMember(db, { firstName: "Ayaba", sex: "female" });
    const other = await createMember(db, { firstName: "Sèwanou", sex: "male" });
    const result = await asUser(db, member, async (tx) => {
      const users = await rows(tx.query<{ locale: string; dark_mode: boolean }>("update app.users set locale = 'yo', dark_mode = true where id = $1 returning locale, dark_mode", [member]));
      await tx.query(
        `insert into app.notification_preferences (user_id, channel, enabled) values ($1, 'whatsapp', false)
         on conflict (user_id, channel) do update set enabled = excluded.enabled`,
        [member],
      );
      await tx.exec("savepoint essai");
      const foreign = await failure(tx.query("insert into app.notification_preferences (user_id, channel, enabled) values ($1, 'sms', false)", [other]));
      await tx.exec("rollback to savepoint essai");
      const otherUser = (await tx.query("update app.users set dark_mode = true where id = $1 returning id", [other])).rows.length;
      const prefs = await rows(tx.query<{ channel: string; enabled: boolean }>("select channel, enabled from app.notification_preferences"));
      return { users, foreign, otherUser, prefs };
    });
    expect(result.users).toEqual([{ locale: "yo", dark_mode: true }]);
    expect(result.foreign).toMatch(/row-level security/);
    expect(result.otherUser).toBe(0);
    expect(result.prefs).toEqual([{ channel: "whatsapp", enabled: false }]);
  });
});
