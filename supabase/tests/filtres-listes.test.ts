import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createEvent, createMember, register } from "./fixtures";

/**
 * Filtres avancés « sur toutes les listes » (section 11.3) : paiements, vérifications et soirées,
 * par le même arbre ET / OU que les membres ; tri, pagination, export journalisé, filtres enregistrés.
 */

let db: PGlite;
let admin: string;
let moderator: string;
let ayaba: string;
let comlan: string;
let houefa: string;
let soon: string;
let past: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
  moderator = await createMember(db, { firstName: "Sèna", sex: "male", role: "moderator" });
  ayaba = await createMember(db, { firstName: "Ayaba", sex: "female", birthDate: "1990-03-01" });
  comlan = await createMember(db, { firstName: "Comlan", sex: "male", birthDate: "1985-07-20" });
  houefa = await createMember(db, { firstName: "Houéfa", sex: "female", birthDate: "1998-11-02", status: "pending_verification" });

  // Soirées : une à venir avec prix et liste d'attente, une terminée sans prix
  soon = await createEvent(db, { startsInHours: 72, capacityWomen: 1 });
  past = await createEvent(db, { startsInHours: -48, status: "finished" });
  await db.query("update app.events set price_xof = 10000 where id = $1", [soon]);
  await register(db, soon, ayaba, "female", "confirmed");
  await db.query("insert into app.waitlist_entries (event_id, user_id, sex, position) values ($1, $2, 'female', 1)", [soon, houefa]);
  await register(db, past, comlan, "male", "checked_in");

  // Paiements : 10 000 FCFA réussi lié à la soirée, 2 500 FCFA remboursé, 500 FCFA en attente
  const pay = async (userId: string, amount: number, status: string, reference: string) =>
    (
      await db.query<{ id: string }>(
        `insert into app.payments (user_id, purpose, amount_xof, provider, provider_transaction_id, status)
         values ($1, 'evening_booking', $2, 'feexpay', $3, $4::app.payment_status) returning id`,
        [userId, amount, reference, status],
      )
    ).rows[0]!.id;
  const paid = await pay(ayaba, 10000, "succeeded", "FX-AYABA");
  await db.query("update app.event_registrations set payment_id = $1 where event_id = $2 and user_id = $3", [paid, soon, ayaba]);
  await pay(comlan, 2500, "refunded", "FX-COMLAN");
  await pay(comlan, 500, "pending", "FX-ATTENTE");

  // Vérifications : Houéfa complète (pièce, selfie, déclaration) en attente ; Comlan validée
  const { rows } = await db.query<{ id: string }>("insert into app.verifications (user_id) values ($1) returning id", [houefa]);
  await db.query(
    `insert into app.id_documents (verification_id, kind, storage_path)
     values ($1, 'passport', 'id-documents/h.jpg'), ($1, 'selfie', 'id-documents/s.jpg')`,
    [rows[0]!.id],
  );
  await db.query(
    "insert into app.honor_declarations (user_id, declared_marital_status, has_children, text_version) values ($1, 'divorced', true, 'v1')",
    [houefa],
  );
  await db.query("insert into app.verifications (user_id, status, decided_at) values ($1, 'approved', now())", [comlan]);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

type Row = Record<string, unknown> & { total: number };

const list = (listName: string, filter: unknown, sort: unknown = null, userId = admin) =>
  asUser(db, userId, async (tx) =>
    (
      await tx.query<{ row: Row }>("select r as row from app.admin_list($1, $2, $3, 200, 0) r", [
        listName,
        filter === null ? null : JSON.stringify(filter),
        sort === null ? null : JSON.stringify(sort),
      ])
    ).rows.map((r) => r.row),
  );

const fails = (listName: string, filter: unknown, sort: unknown = null) =>
  asUser(db, admin, (tx) =>
    failure(tx.query("select * from app.admin_list($1, $2, $3)", [listName, JSON.stringify(filter), sort === null ? null : JSON.stringify(sort)])),
  );

describe("Filtres avancés des autres listes (11.3)", () => {
  it("permissions : modérateur refusé partout, liste inconnue refusée", async () => {
    for (const name of ["payments", "verifications", "events"]) {
      const error = await asUser(db, moderator, (tx) => failure(tx.query("select * from app.admin_list($1)", [name])));
      expect(error).toMatch(/forbidden/);
    }
    expect(await asUser(db, admin, (tx) => failure(tx.query("select * from app.admin_list('members')")))).toMatch(/forbidden/);
  });

  it("paiements : plage de montants, liste, texte, remboursement, groupes ET / OU", async () => {
    const refs = async (filter: unknown, sort: unknown = null) => (await list("payments", filter, sort)).map((r) => r.provider_transaction_id);
    expect(await refs({ field: "amount", cmp: "between", value: [1000, null] }, [{ field: "amount", dir: "desc" }])).toEqual(["FX-AYABA", "FX-COMLAN"]);
    expect(await refs({ field: "refund", cmp: "in", value: ["refunded"] })).toEqual(["FX-COMLAN"]);
    expect(await refs({ field: "reference", cmp: "contains", value: "attente" })).toEqual(["FX-ATTENTE"]);
    const nested = {
      op: "or",
      items: [
        { field: "status", cmp: "in", value: ["pending"] },
        { op: "and", items: [{ field: "member", cmp: "contains", value: "ayaba" }, { field: "reconciled", cmp: "is", value: false }] },
      ],
    };
    expect(await refs(nested, [{ field: "amount", dir: "asc" }])).toEqual(["FX-ATTENTE", "FX-AYABA"]);
    const [row] = await list("payments", { field: "event_date", cmp: "between", value: ["2000-01-01", null] });
    expect(row).toMatchObject({ provider_transaction_id: "FX-AYABA", event_id: soon, total: 1 });
  });

  it("vérifications : tous les dossiers, état, complet, déclaration, âge", async () => {
    const who = async (filter: unknown) => (await list("verifications", filter)).map((r) => r.first_name);
    expect(await who(null)).toEqual(["Houéfa", "Comlan"]);
    expect(await who({ field: "status", cmp: "in", value: ["approved"] })).toEqual(["Comlan"]);
    expect(await who({ op: "and", items: [{ field: "ready", cmp: "is", value: true }, { field: "has_selfie", cmp: "is", value: true }] })).toEqual(["Houéfa"]);
    expect(await who({ field: "declared_status", cmp: "in", value: ["divorced"] })).toEqual(["Houéfa"]);
    expect(await who({ field: "age", cmp: "between", value: [35, null] })).toEqual(["Comlan"]);
  });

  it("soirées : état, prix, liste d'attente, date de Cotonou, lieu", async () => {
    const ids = async (filter: unknown, sort: unknown = null) => (await list("events", filter, sort)).map((r) => r.id);
    expect(await ids(null)).toEqual([soon, past]);
    expect(await ids(null, [{ field: "starts_at", dir: "asc" }])).toEqual([past, soon]);
    expect(await ids({ field: "price", cmp: "between", value: [10000, 10000] })).toEqual([soon]);
    expect(await ids({ field: "waiting", cmp: "between", value: [1, null] })).toEqual([soon]);
    expect(await ids({ field: "status", cmp: "in", value: ["finished"] })).toEqual([past]);
    expect(await ids({ field: "has_venue", cmp: "is", value: true })).toEqual([soon, past]);
    const [row] = await list("events", { field: "taken_women", cmp: "between", value: [1, 1] });
    expect(row).toMatchObject({ id: soon, taken_women: 1, waiting_women: 1, capacity_women: 1, total: 1 });
  });

  it("champ d'une autre liste, comparaison, valeur, tri ou profondeur hors règles : refusés", async () => {
    expect(await fails("payments", { field: "age", cmp: "between", value: [1, 2] })).toMatch(/invalid_filter/);
    expect(await fails("events", { field: "status", cmp: "in", value: ["perdu"] })).toMatch(/invalid_filter/);
    expect(await fails("payments", { field: "amount", cmp: "between", value: [null, null] })).toMatch(/invalid_filter/);
    expect(await fails("payments", { field: "amount", cmp: "between", value: ["1; drop table app.payments", null] })).toMatch(/invalid_filter/);
    expect(await fails("verifications", { field: "submitted_at", cmp: "between", value: ["hier", null] })).toMatch(/invalid_filter/);
    expect(await fails("events", { field: "venue", cmp: "in", value: ["x"] })).toMatch(/invalid_filter/);
    const deep = { op: "and", items: [{ op: "and", items: [{ op: "and", items: [{ op: "and", items: [] }] }] }] };
    expect(await fails("events", deep)).toMatch(/invalid_filter/);
    expect(await fails("events", null, [{ field: "venue", dir: "asc" }])).toMatch(/invalid_sort/);
    // Une apostrophe reste une valeur
    expect(await list("events", { field: "venue", cmp: "contains", value: "'; select 1; --" })).toEqual([]);
  });

  it("pagination côté serveur : total de toutes les pages", async () => {
    const rows = await asUser(db, admin, async (tx) =>
      (await tx.query<{ row: Row }>("select r as row from app.admin_list('payments', null, null, 1, 1) r")).rows.map((r) => r.row),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total).toBe(3);
  });

  it("export : 5 000 lignes au plus, format contrôlé, journalisé", async () => {
    const filter = { field: "status", cmp: "in", value: ["succeeded", "refunded"] };
    const { rows, audit } = await asUser(db, admin, async (tx) => {
      const rows = (await tx.query("select * from app.admin_list_export('payments', $1, null, 'xlsx')", [JSON.stringify(filter)])).rows;
      // Journal lisible par la seule super administration : lecture avec les droits de la base
      await tx.exec("reset role");
      const audit = (
        await tx.query<{ details: { rows: number; format: string } }>(
          "select details from app.audit_log where action = 'payments.exported' and actor_id = $1",
          [admin],
        )
      ).rows;
      return { rows, audit };
    });
    expect(rows).toHaveLength(2);
    expect(await asUser(db, admin, (tx) => failure(tx.query("select * from app.admin_list_export('payments', null, null, 'pdf')")))).toMatch(
      /invalid_format/,
    );
    expect(await asUser(db, moderator, (tx) => failure(tx.query("select * from app.admin_list_export('events', null, null, 'csv')")))).toMatch(
      /forbidden/,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ rows: 2, format: "xlsx" });
  });

  it("filtres enregistrés : par liste, contrôlés à l'écriture, réservés à la permission de la liste", async () => {
    const save = (userId: string, resource: string, definition: unknown, columns: string[] | null = null) =>
      asUser(db, userId, (tx) =>
        failure(
          tx.query("insert into app.saved_filters (owner_id, resource, name, definition, columns, shared) values ($1, $2, 'Essai', $3, $4, true)", [
            userId,
            resource,
            JSON.stringify(definition),
            columns,
          ]),
        ),
      );
    expect(await save(admin, "payments", { op: "and", items: [{ field: "amount", cmp: "between", value: [1000, null] }] }, ["date", "amount"])).toBeNull();
    expect(await save(admin, "events", { op: "and", items: [{ field: "amount", cmp: "between", value: [1000, null] }] })).toMatch(/invalid_filter/);
    expect(await save(admin, "events", { op: "and", items: [] }, ["phone"])).toMatch(/invalid_columns/);
    expect(await save(admin, "lieux", { op: "and", items: [] })).not.toBeNull();
    expect(await save(moderator, "verifications", { op: "and", items: [] })).not.toBeNull();
    const seen = await asUser(db, moderator, async (tx) => (await tx.query("select id from app.saved_filters where resource = 'payments'")).rows);
    expect(seen).toEqual([]);
  });
});

describe("Filtres des listes Lieux, Thèmes et Modération (question 32)", () => {
  it("lieux : texte, partenaire, nombre de soirées ; réservé à events.manage", async () => {
    await db.query("insert into app.venues (name, address, city, is_partner) values ('Salle Ganhi (lieu fictif)', 'Adresse fictive', 'Porto-Novo', false)");
    const names = async (filter: unknown, sort: unknown = null) => (await list("venues", filter, sort)).map((r) => r.name);
    expect(await names({ field: "city", cmp: "contains", value: "porto" })).toEqual(["Salle Ganhi (lieu fictif)"]);
    expect(await names({ field: "events", cmp: "between", value: [1, null] })).toHaveLength(2);
    expect(await names({ op: "and", items: [{ field: "is_partner", cmp: "is", value: false }, { field: "events", cmp: "between", value: [null, 0] }] })).toEqual([
      "Salle Ganhi (lieu fictif)",
    ]);
    expect(await asUser(db, moderator, (tx) => failure(tx.query("select * from app.admin_list('venues')")))).toMatch(/forbidden/);
  });

  it("thèmes : nom dans les trois langues, âges, critères, soirées", async () => {
    const keys = async (filter: unknown) => (await list("themes", filter)).map((r) => r.key);
    expect(await keys({ field: "name", cmp: "contains", value: "25 to 35" })).toEqual(["age-25-35"]);
    expect(await keys({ op: "and", items: [{ field: "min_age", cmp: "between", value: [25, 25] }, { field: "has_religions", cmp: "is", value: false }] })).toEqual([
      "age-25-35",
    ]);
    const all = await list("themes", null, [{ field: "events", dir: "desc" }]);
    expect(all.length).toBeGreaterThan(1);
    expect(all.every((r) => r.events === 0)).toBe(true);
  });

  it("modération : textes en attente seulement, champ, contenu ; modérateur autorisé", async () => {
    await db.query("insert into app.profile_texts (user_id, field, body) values ($1, 'who_i_am', 'J''aime la cuisine du dimanche')", [ayaba]);
    await db.query("insert into app.profile_texts (user_id, field, body, review_status) values ($1, 'who_i_am', 'Déjà relu', 'approved')", [comlan]);
    const rows = await list("moderation", { field: "body", cmp: "contains", value: "cuisine" }, null, moderator);
    expect(rows.map((r) => r.first_name)).toEqual(["Ayaba"]);
    expect(await list("moderation", { field: "field", cmp: "in", value: ["what_matters"] }, null, moderator)).toEqual([]);
    expect((await list("moderation", null, null, moderator)).map((r) => r.first_name)).toEqual(["Ayaba"]);
    expect(await fails("moderation", { field: "field", cmp: "in", value: ["autre"] })).toMatch(/invalid_filter/);
  });

  it("liste inconnue et liste des membres refusées par ce moteur ; filtre enregistré accepté", async () => {
    expect(await asUser(db, admin, (tx) => failure(tx.query("select * from app.admin_list('lieux')")))).toMatch(/forbidden/);
    expect(await asUser(db, admin, (tx) => failure(tx.query("select * from app.admin_list_export('members', null, null, 'csv')")))).toMatch(/forbidden/);
    const error = await asUser(db, admin, (tx) =>
      failure(
        tx.query("insert into app.saved_filters (owner_id, resource, name, definition, columns) values ($1, 'themes', 'Âges', $2, $3)", [
          admin,
          JSON.stringify({ op: "and", items: [{ field: "min_age", cmp: "between", value: [18, null] }] }),
          ["events"],
        ]),
      ),
    );
    expect(error).toBeNull();
  });
});
