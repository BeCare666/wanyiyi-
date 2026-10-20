import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Filtres avancés de l'administration (section 11.3), liste des membres : groupes ET / OU
 * imbriqués, champs en liste blanche, tri multi-colonnes, filtres enregistrés et partagés.
 */

let db: PGlite;
let admin: string;
let otherAdmin: string;
let moderator: string;
const people: Record<string, string> = {};

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  otherAdmin = await createMember(db, { firstName: "Gbènakpon", sex: "male", role: "super_admin" });
  moderator = await createMember(db, { firstName: "Sèna", sex: "male", role: "moderator" });
  people.ayaba = await createMember(db, { firstName: "Ayaba", sex: "female", birthDate: "1990-03-01" });
  people.comlan = await createMember(db, { firstName: "Comlan", sex: "male", birthDate: "1985-07-20" });
  people.houefa = await createMember(db, { firstName: "Houéfa", sex: "female", birthDate: "1998-11-02", status: "pending_verification" });
  // Comlan : 4 soirées sans match (exemple du cahier des charges : « plus de 3 soirées sans match »)
  for (let i = 0; i < 4; i++) {
    const event = await createEvent(db, { startsInHours: -24 * (i + 2), status: "finished" });
    await register(db, event, people.comlan!, "male", "checked_in");
  }
  await db.query("insert into app.sanctions (user_id, kind, reason, decided_by) values ($1, 'warning', 'Retard', $2)", [people.ayaba, admin]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const names = (filter: unknown, sort: unknown = null) =>
  asUser(db, admin, async (tx) =>
    (
      await tx.query<{ first_name: string }>("select first_name from app.admin_members_filtered($1, $2, 200, 0)", [
        filter === null ? null : JSON.stringify(filter),
        sort === null ? null : JSON.stringify(sort),
      ])
    ).rows.map((r) => r.first_name),
  );

const fails = (filter: unknown, sort: unknown = null) =>
  asUser(db, admin, (tx) =>
    failure(tx.query("select * from app.admin_members_filtered($1, $2)", [JSON.stringify(filter), sort === null ? null : JSON.stringify(sort)])),
  );

describe("Filtres avancés des membres (11.3)", () => {
  it("modérateur : refusé", async () => {
    const error = await asUser(db, moderator, (tx) => failure(tx.query("select * from app.admin_members_filtered()")));
    expect(error).toMatch(/forbidden/);
  });

  it("texte, liste, plage d'âge, oui / non", async () => {
    expect(await names({ field: "name", cmp: "contains", value: "houé" })).toEqual(["Houéfa"]);
    expect(await names({ field: "status", cmp: "in", value: ["pending_verification"] })).toEqual(["Houéfa"]);
    expect(await names({ field: "age", cmp: "between", value: [40, null] })).toEqual(["Comlan"]);
    expect(await names({ field: "sanctioned", cmp: "is", value: true })).toEqual(["Ayaba"]);
  });

  it("relation : plus de 3 soirées sans match ; groupes ET / OU imbriqués", async () => {
    const noMatch = { field: "matches", cmp: "between", value: [0, 0] };
    expect(await names({ op: "and", items: [{ field: "evenings_attended", cmp: "between", value: [4, null] }, noMatch] })).toEqual(["Comlan"]);
    const nested = {
      op: "and",
      items: [
        { field: "sex", cmp: "in", value: ["female"] },
        { op: "or", items: [{ field: "name", cmp: "contains", value: "ayaba" }, { field: "status", cmp: "in", value: ["pending_verification"] }] },
      ],
    };
    expect((await names(nested, [{ field: "name", dir: "asc" }]))).toEqual(["Ayaba", "Houéfa"]);
  });

  it("date d'inscription en heure de Cotonou ; tri multi-colonnes", async () => {
    const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const all = await names({ field: "created_at", cmp: "between", value: [today, today] });
    expect(all).toHaveLength(6);
    const sorted = await names({ field: "role", cmp: "in", value: ["member"] }, [
      { field: "sex", dir: "asc" },
      { field: "age", dir: "desc" },
    ]).catch((e: Error) => e.message);
    expect(sorted).toMatch(/invalid_sort/); // « sex » n'est pas une colonne de tri
    expect(await names({ field: "role", cmp: "in", value: ["member"] }, [{ field: "age", dir: "desc" }])).toEqual(["Comlan", "Ayaba", "Houéfa"]);
  });

  it("champ, comparaison, valeur ou profondeur hors règles : refusés, rien n'entre tel quel dans la requête", async () => {
    for (const bad of [
      { field: "phone; drop table app.users", cmp: "contains", value: "1" },
      { field: "name", cmp: "equals", value: "x" },
      { field: "name", cmp: "contains", value: "" },
      { field: "status", cmp: "in", value: ["verified', 'x"] },
      { field: "age", cmp: "between", value: ["18 or true", null] },
      { field: "age", cmp: "between", value: [null, null] },
      { field: "created_at", cmp: "between", value: ["hier", null] },
      { op: "xor", items: [] },
      { op: "and", items: [{ op: "and", items: [{ op: "and", items: [{ op: "and", items: [] }] }] }] },
      { op: "and", items: Array.from({ length: 21 }, () => ({ field: "name", cmp: "contains", value: "a" })) },
    ]) {
      expect(await fails(bad), JSON.stringify(bad).slice(0, 60)).toMatch(/invalid_filter/);
    }
    // Apostrophe dans un texte : simple caractère recherché
    expect(await names({ field: "name", cmp: "contains", value: "' or '1'='1" })).toEqual([]);
  });

  it("filtres enregistrés : personnels, ou partagés entre administrateurs ; contrôlés à l'écriture", async () => {
    const result = await asUser(db, admin, async (tx) => {
      const insert = (name: string, shared: boolean, filter: unknown, columns: string[] | null = null) =>
        tx.query("insert into app.saved_filters (owner_id, resource, name, definition, shared, columns) values ($1, 'members', $2, $3, $4, $5)", [
          admin,
          name,
          JSON.stringify(filter),
          shared,
          columns,
        ]);
      await insert("Perso", false, { field: "sex", cmp: "in", value: ["female"] });
      await insert("Équipe", true, { field: "status", cmp: "in", value: ["verified"] }, ["status", "activity"]);
      await tx.exec("savepoint s");
      const invalid = await failure(insert("Cassé", false, { field: "inconnu", cmp: "contains", value: "x" }));
      await tx.exec("rollback to savepoint s");
      const badColumns = await failure(insert("Colonnes", false, { op: "and", items: [] }, ["password"]));
      await tx.exec("rollback to savepoint s");
      // Vu par une autre administratrice dans la même transaction
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: otherAdmin, role: "authenticated" })]);
      const seenByOther = (await tx.query<{ name: string }>("select name from app.saved_filters order by name")).rows.map((r) => r.name);
      const deletedByOther = (await tx.query("delete from app.saved_filters returning id")).rows.length;
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: moderator, role: "authenticated" })]);
      const seenByModerator = (await tx.query("select name from app.saved_filters")).rows.length;
      return { invalid, badColumns, seenByOther, deletedByOther, seenByModerator };
    });
    expect(result.invalid).toMatch(/invalid_filter/);
    expect(result.badColumns).toMatch(/invalid_columns/);
    expect(result.seenByOther).toEqual(["Équipe"]);
    expect(result.deletedByOther).toBe(0);
    expect(result.seenByModerator).toBe(0);
  });
});

describe("Export des membres (11.3, décisions du 19 octobre 2026)", () => {
  const exportAs = (userId: string, format = "csv") =>
    asUser(db, userId, async (tx) => {
      const rows = (
        await tx.query<{ first_name: string; phone: string | null }>("select first_name, phone from app.admin_members_export($1, $2, $3)", [
          JSON.stringify({ field: "role", cmp: "in", value: ["member"] }),
          JSON.stringify([{ field: "name", dir: "asc" }]),
          format,
        ])
      ).rows;
      // Journal lisible par la seule super administration : lecture avec les droits de la base
      await tx.exec("reset role");
      const audit = (
        await tx.query<{ details: Record<string, unknown> }>("select details from app.audit_log where action = 'members.exported' and actor_id = $1", [userId])
      ).rows;
      return { rows, audit };
    });

  it("même filtre et même tri que la liste ; téléphones pour la super administration seulement ; journalisé", async () => {
    const byAdmin = await exportAs(admin);
    expect(byAdmin.rows.map((r) => r.first_name)).toEqual(["Ayaba", "Comlan", "Houéfa"]);
    expect(byAdmin.rows.every((r) => r.phone === null)).toBe(true);
    expect(byAdmin.audit).toHaveLength(1);
    expect(byAdmin.audit[0]!.details).toMatchObject({ format: "csv", rows: 3, phone: false });

    const bySuperAdmin = await exportAs(otherAdmin, "xlsx");
    expect(bySuperAdmin.rows.every((r) => typeof r.phone === "string" && r.phone.startsWith("+229"))).toBe(true);
    expect(bySuperAdmin.audit[0]!.details).toMatchObject({ format: "xlsx", rows: 3, phone: true });
  });

  it("modérateur refusé ; format inconnu refusé", async () => {
    expect(await asUser(db, moderator, (tx) => failure(tx.query("select * from app.admin_members_export(null, null, 'csv')")))).toMatch(/forbidden/);
    expect(await asUser(db, admin, (tx) => failure(tx.query("select * from app.admin_members_export(null, null, 'pdf')")))).toMatch(/invalid_format/);
  });
});
