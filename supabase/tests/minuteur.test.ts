import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Minuteur de soirée sur tablette (note : « pilote les tours, signal visuel et sonore » ;
 * question 8 du 22 octobre 2026 : pas de pause, les tours s'enchaînent).
 */

let db: PGlite;
let admin: string;
let member: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  member = await createMember(db, { firstName: "Afiwa", sex: "female" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("Minuteur des tours (question 8)", () => {
  it("démarré par l'équipe sur une soirée en cours : tours de 7 min, 1 min de changement, sans pause ; une seule fois", async () => {
    const event = await createEvent(db, { startsInHours: -5 / 60 });
    const women = [member, await createMember(db, { firstName: "Sèna", sex: "female" }), await createMember(db, { firstName: "Mariam", sex: "female" })];
    const men = [await createMember(db, { firstName: "Koffi", sex: "male" }), await createMember(db, { firstName: "Dossou", sex: "male" }), await createMember(db, { firstName: "Codjo", sex: "male" })];
    for (const w of women) await register(db, event, w, "female", "checked_in");
    for (const m of men) await register(db, event, m, "male", "checked_in");

    const result = await asUser(db, admin, async (tx) => {
      const attempt = async (sql: string) => {
        await tx.exec("savepoint essai");
        const error = await failure(tx.query(sql, [event]));
        await tx.exec(error ? "rollback to savepoint essai" : "release savepoint essai");
        return error;
      };
      const notPrepared = await attempt("select app.start_timer($1)");
      await tx.query("select app.prepare_evening($1)", [event]);
      const notStarted = await attempt("select app.start_timer($1)");
      await tx.query("select app.start_evening($1)", [event]);
      const [{ start }] = (await tx.query<{ start: Date }>("select app.start_timer($1) as start", [event])).rows as [{ start: Date }];
      const again = await attempt("select app.start_timer($1)");
      const rounds = (await tx.query<{ round_number: number; started_at: Date; ended_at: Date }>("select * from app.evening_timer($1)", [event])).rows;
      await tx.exec("reset role");
      const audit = (await tx.query<{ actor_id: string }>("select actor_id from app.audit_log where action = 'evening.timer_started' and target_id = $1", [event])).rows;
      return { notPrepared, notStarted, again, start, rounds, audit };
    });

    expect(result.notPrepared).toMatch(/invalid_status|not_prepared/);
    expect(result.notStarted).toMatch(/invalid_status/);
    expect(result.again).toMatch(/already_started/);
    const t0 = new Date(result.start).getTime();
    const minutes = (d: Date) => (new Date(d).getTime() - t0) / 60_000;
    expect(result.rounds.map((r) => [r.round_number, minutes(r.started_at), minutes(r.ended_at)])).toEqual([
      [1, 0, 7],
      [2, 8, 15],
      [3, 16, 23],
    ]);
    expect(result.audit).toEqual([{ actor_id: admin }]);
  });

  it("réservé à l'équipe des soirées", async () => {
    const event = await createEvent(db, { startsInHours: -5 / 60, status: "in_progress" });
    expect(await asUser(db, member, (tx) => failure(tx.query("select app.start_timer($1)", [event])))).toMatch(/forbidden/);
    expect(await asUser(db, member, (tx) => failure(tx.query("select * from app.evening_timer($1)", [event])))).toMatch(/forbidden/);
  });
});
