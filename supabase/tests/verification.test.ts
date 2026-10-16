import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, failure } from "./db";
import { createMember } from "./fixtures";

/**
 * Dépôt du dossier de vérification (section 6.2-2, décisions du 17 octobre 2026) :
 * une pièce (carte ou permis recto et verso, passeport page photo), un selfie visage seul,
 * la déclaration sur l'honneur, et le passage « en attente de vérification ».
 */

let db: PGlite;
let admin: string;

beforeAll(async () => {
  db = await createDb();
  admin = await createMember(db, { firstName: "Rachidatou", sex: "female", role: "admin" });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const rows = async <T>(p: Promise<{ rows: T[] }>) => (await p).rows;

/** Change l'identité dans la même transaction (le rôle reste « authenticated »). */
const actAs = (tx: Transaction, userId: string) =>
  tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);

/** Une tentative qui doit échouer, sans casser la transaction du test. */
async function attempt(tx: Transaction, sql: string, params: unknown[] = []) {
  await tx.exec("savepoint essai");
  const error = await failure(tx.query(sql, params));
  await tx.exec(error ? "rollback to savepoint essai" : "release savepoint essai");
  return error;
}

/** Dépose des fichiers dans le compartiment, comme le ferait le site avec le jeton du membre. */
async function upload(tx: Transaction, userId: string, ...files: string[]) {
  for (const file of files) {
    await tx.query("insert into storage.objects (bucket_id, name) values ('id-documents', $1)", [`${userId}/${file}`]);
  }
  return files.map((file) => `${userId}/${file}`);
}

const submit = (tx: Transaction, kind: string, front: string | null, back: string | null, selfie: string | null) =>
  tx.query("select app.submit_id_documents($1::app.document_kind, $2, $3, $4)", [kind, front, back, selfie]);

const sign = (tx: Transaction, status: string, children: boolean, other: string | null = null, version = "v1") =>
  tx.query("select app.sign_honor_declaration($1, $2, $3, $4)", [status, children, other, version]);

const profileStatus = async (tx: Transaction, userId: string) =>
  (await rows(tx.query<{ status: string }>("select status from app.member_profiles where user_id = $1", [userId])))[0]?.status;

describe("Compartiment privé des pièces", () => {
  it("dépôt dans son propre dossier seulement, sans relecture, remplacement ni suppression", async () => {
    const member = await createMember(db, { firstName: "Ayaba", sex: "female", status: "registering" });
    const other = await createMember(db, { firstName: "Codjo", sex: "male", status: "registering" });
    const result = await asUser(db, member, async (tx) => {
      await upload(tx, member, "recto.jpg");
      return {
        foreignFolder: await attempt(tx, "insert into storage.objects (bucket_id, name) values ('id-documents', $1)", [`${other}/recto.jpg`]),
        rootFolder: await attempt(tx, "insert into storage.objects (bucket_id, name) values ('id-documents', 'recto.jpg')"),
        read: (await tx.query("select name from storage.objects")).rows.length,
        replaced: (await tx.query("update storage.objects set name = name || '.bis' returning id")).rows.length,
        deleted: (await tx.query("delete from storage.objects returning id")).rows.length,
      };
    });
    expect(result.foreignFolder).toMatch(/row-level security/);
    expect(result.rootFolder).toMatch(/row-level security/);
    expect(result).toMatchObject({ read: 0, replaced: 0, deleted: 0 });
    const [bucket] = await rows(db.query<{ public: boolean }>("select public from storage.buckets where id = 'id-documents'"));
    expect(bucket?.public).toBe(false);
  });
});

describe("Dépôt de la pièce et du selfie", () => {
  it("carte et permis : recto et verso ; passeport : page photo seule ; selfie obligatoire ; une seule pièce", async () => {
    const member = await createMember(db, { firstName: "Houéfa", sex: "female", status: "registering" });
    const errors = await asUser(db, member, async (tx) => {
      const [front, back, selfie] = await upload(tx, member, "a.jpg", "b.jpg", "c.jpg");
      const call = (kind: string, f: string | null, b: string | null, s: string | null) =>
        attempt(tx, "select app.submit_id_documents($1::app.document_kind, $2, $3, $4)", [kind, f, b, s]);
      return {
        cardWithoutBack: await call("id_card", front!, null, selfie!),
        licenceWithoutBack: await call("driving_licence", front!, null, selfie!),
        passportWithBack: await call("passport", front!, back!, selfie!),
        noSelfie: await call("passport", front!, null, null),
        otherKind: await call("other", front!, back!, selfie!),
        selfieAsDocument: await call("selfie", front!, back!, selfie!),
        sameFileTwice: await call("id_card", front!, front!, selfie!),
        notUploaded: await call("passport", `${member}/absent.jpg`, null, selfie!),
        passportOk: await call("passport", front!, null, selfie!),
        cardOk: await call("id_card", front!, back!, selfie!),
      };
    });
    expect(errors).toEqual({
      cardWithoutBack: expect.stringMatching(/document_missing/),
      licenceWithoutBack: expect.stringMatching(/document_missing/),
      passportWithBack: expect.stringMatching(/invalid_document_kind/),
      noSelfie: expect.stringMatching(/document_missing/),
      otherKind: expect.stringMatching(/invalid_document_kind/),
      selfieAsDocument: expect.stringMatching(/invalid_document_kind/),
      sameFileTwice: expect.stringMatching(/duplicate_file/),
      notUploaded: expect.stringMatching(/file_not_found/),
      passportOk: null,
      cardOk: null,
    });
  });

  it("refuse le fichier d'un autre membre et toute écriture directe dans les tables", async () => {
    const member = await createMember(db, { firstName: "Mahougnon", sex: "female", status: "registering" });
    const other = await createMember(db, { firstName: "Sèwanou", sex: "male", status: "registering" });
    const result = await asUser(db, member, async (tx) => {
      await actAs(tx, other);
      const [foreign] = await upload(tx, other, "recto.jpg");
      await actAs(tx, member);
      const [selfie] = await upload(tx, member, "selfie.jpg");
      return {
        foreign: await attempt(tx, "select app.submit_id_documents('passport', $1, null, $2)", [foreign, selfie]),
        verification: await attempt(tx, "insert into app.verifications (user_id) values ($1)", [member]),
        declaration: await attempt(
          tx,
          "insert into app.honor_declarations (user_id, declared_marital_status, text_version) values ($1, 'single', 'v1')",
          [member],
        ),
      };
    });
    expect(result.foreign).toMatch(/file_not_found/);
    expect(result.verification).toMatch(/row-level security/);
    expect(result.declaration).toMatch(/row-level security/);
  });

  it("un nouveau dépôt remplace le précédent, qui reste dans l'historique", async () => {
    const member = await createMember(db, { firstName: "Gbènakpon", sex: "male", status: "registering" });
    const docs = await asUser(db, member, async (tx) => {
      const [passport, selfie, front, back, selfie2] = await upload(tx, member, "p.jpg", "s.jpg", "r.jpg", "v.jpg", "s2.jpg");
      await submit(tx, "passport", passport!, null, selfie!);
      await submit(tx, "driving_licence", front!, back!, selfie2!);
      await tx.exec("reset role");
      return rows(
        tx.query<{ kind: string; part: string; current: boolean }>(
          `select d.kind, d.part, d.superseded_at is null as current from app.id_documents d
           join app.verifications v on v.id = d.verification_id where v.user_id = $1 order by d.uploaded_at, d.part`,
          [member],
        ),
      );
    });
    expect(docs.filter((d) => d.current).map((d) => `${d.kind}:${d.part}`).sort()).toEqual([
      "driving_licence:back",
      "driving_licence:front",
      "selfie:face",
    ]);
    expect(docs.filter((d) => !d.current).map((d) => `${d.kind}:${d.part}`).sort()).toEqual(["passport:photo_page", "selfie:face"]);
  });
});

describe("Déclaration sur l'honneur", () => {
  it("situations prévues, « autre » toujours précisé, enfants obligatoires, version en vigueur seulement", async () => {
    const member = await createMember(db, { firstName: "Djidjoho", sex: "male", status: "registering" });
    const result = await asUser(db, member, async (tx) => {
      const call = (status: string, children: boolean | null, other: string | null, version = "v1") =>
        attempt(tx, "select app.sign_honor_declaration($1, $2, $3, $4)", [status, children, other, version]);
      return {
        married: await call("married", false, null),
        otherWithoutDetails: await call("other", false, "   "),
        detailsWithoutOther: await call("single", false, "précision"),
        noChildrenAnswer: await call("divorced", null, null),
        oldVersion: await call("single", false, null, "v0"),
        single: await call("single", true, null),
        other: await call("other", false, "Marié coutumièrement, séparé depuis 2023."),
        declarations: await rows(
          tx.query<{ declared_marital_status: string; has_children: boolean; other_details: string | null }>(
            "select declared_marital_status, has_children, other_details from app.honor_declarations order by signed_at, declared_marital_status",
          ),
        ),
      };
    });
    expect(result.married).toMatch(/invalid_declaration/);
    expect(result.otherWithoutDetails).toMatch(/invalid_declaration/);
    expect(result.detailsWithoutOther).toMatch(/invalid_declaration/);
    expect(result.noChildrenAnswer).toMatch(/invalid_declaration/);
    expect(result.oldVersion).toMatch(/outdated_declaration/);
    expect(result.single).toBeNull();
    expect(result.other).toBeNull();
    // Même transaction, donc même heure de signature : tri par situation
    expect(result.declarations).toEqual([
      { declared_marital_status: "other", has_children: false, other_details: "Marié coutumièrement, séparé depuis 2023." },
      { declared_marital_status: "single", has_children: true, other_details: null },
    ]);
  });
});

describe("Suivi du dossier et état du membre", () => {
  it("dossier complet : « en attente de vérification » ; correction demandée puis nouveau dépôt ; dossier clos après validation", async () => {
    const member = await createMember(db, { firstName: "Sèna", sex: "female", status: "registering" });
    const flow = await asUser(db, member, async (tx) => {
      const steps: Record<string, unknown> = {};
      steps.selfPromotion = await attempt(tx, "update app.member_profiles set status = 'pending_verification' where user_id = $1", [member]);
      const [front, back, selfie] = await upload(tx, member, "r.jpg", "v.jpg", "s.jpg");
      await submit(tx, "id_card", front!, back!, selfie!);
      steps.afterDocuments = await profileStatus(tx, member);
      await sign(tx, "widowed", true);
      steps.afterDeclaration = await profileStatus(tx, member);
      steps.tracking = (await rows(tx.query("select status, document_kind, has_selfie, declared_status, has_children from app.my_verification()")))[0];

      // L'équipe demande une correction
      await actAs(tx, admin);
      await tx.query("select app.decide_verification(id, 'to_correct', 'Verso illisible.') from app.verifications where user_id = $1", [member]);
      await actAs(tx, member);
      steps.afterCorrection = await profileStatus(tx, member);
      steps.note = (await rows(tx.query<{ correction_note: string }>("select correction_note from app.my_verification()")))[0]?.correction_note;

      // Le membre dépose de nouveau : retour en vérification, sans décision attribuée au membre
      const [back2] = await upload(tx, member, "v2.jpg");
      await submit(tx, "id_card", front!, back2!, selfie!);
      steps.afterResubmission = await profileStatus(tx, member);
      await tx.exec("reset role");
      steps.verification = (
        await rows(tx.query("select status, decided_by, decided_at from app.verifications where user_id = $1", [member]))
      )[0];
      steps.audit = (
        await rows(tx.query<{ action: string }>("select action from app.audit_log where actor_id = $1 order by created_at, action", [member]))
      ).map((a) => a.action);
      await tx.exec("set local role authenticated");

      // Validation par l'équipe : le dossier est clos
      await actAs(tx, admin);
      await tx.query("select app.decide_verification(id, 'approved', null) from app.verifications where user_id = $1", [member]);
      await actAs(tx, member);
      steps.afterApproval = await profileStatus(tx, member);
      steps.closed = await attempt(tx, "select app.sign_honor_declaration('single', false, null, 'v1')");
      return steps;
    });

    expect(flow.selfPromotion).toMatch(/forbidden_column/);
    expect(flow.afterDocuments).toBe("registering");
    expect(flow.afterDeclaration).toBe("pending_verification");
    expect(flow.tracking).toEqual({ status: "pending", document_kind: "id_card", has_selfie: true, declared_status: "widowed", has_children: true });
    expect(flow.afterCorrection).toBe("to_correct");
    expect(flow.note).toBe("Verso illisible.");
    expect(flow.afterResubmission).toBe("pending_verification");
    expect(flow.verification).toEqual({ status: "pending", decided_by: null, decided_at: null });
    expect(flow.audit).toEqual(expect.arrayContaining(["honor.signed", "id_document.submitted", "verification.resubmitted"]));
    expect(flow.afterApproval).toBe("verified");
    expect(flow.closed).toMatch(/verification_closed/);
  });

  it("sans aucun dépôt, le suivi est vide", async () => {
    const member = await createMember(db, { firstName: "Codjo", sex: "male", status: "registering" });
    expect(await asUser(db, member, (tx) => rows(tx.query("select * from app.my_verification()")))).toEqual([]);
  });
});

describe("Administration : file des vérifications et décision (11.2-3)", () => {
  it("file réservée à la vérification : dossiers ouverts, complets ou non, sans aucun chemin de fichier", async () => {
    const moderator = await createMember(db, { firstName: "Gildas", sex: "male", role: "moderator" });
    const complete = await createMember(db, { firstName: "Afiwa", sex: "female", status: "registering" });
    const partial = await createMember(db, { firstName: "Koffi", sex: "male", status: "registering" });
    const result = await asUser(db, complete, async (tx) => {
      const [front, back, selfie] = await upload(tx, complete, "r.jpg", "v.jpg", "s.jpg");
      await submit(tx, "id_card", front!, back!, selfie!);
      await sign(tx, "single", false);
      await actAs(tx, partial);
      await sign(tx, "divorced", true);

      await actAs(tx, moderator);
      const forbidden = await attempt(tx, "select * from app.verification_queue()");
      await actAs(tx, admin);
      const queue = await rows(
        tx.query<{ user_id: string; first_name: string; document_kind: string | null; has_selfie: boolean; declared_status: string; ready: boolean }>(
          "select user_id, first_name, document_kind, has_selfie, declared_status, ready from app.verification_queue() where user_id = any($1::uuid[]) order by first_name",
          [[complete, partial]],
        ),
      );
      const [ver] = await rows(tx.query<{ id: string }>("select id from app.verifications where user_id = $1", [complete]));
      const documents = await rows(tx.query<Record<string, unknown>>("select * from app.verification_documents($1)", [ver!.id]));
      return { forbidden, queue, documents };
    });
    expect(result.forbidden).toMatch(/forbidden/);
    expect(result.queue).toEqual([
      { user_id: complete, first_name: "Afiwa", document_kind: "id_card", has_selfie: true, declared_status: "single", ready: true },
      { user_id: partial, first_name: "Koffi", document_kind: null, has_selfie: false, declared_status: "divorced", ready: false },
    ]);
    expect(result.documents.map((d) => `${d.kind}:${d.part}`)).toEqual(["id_card:front", "id_card:back", "selfie:face"]);
    expect(result.documents.every((d) => !("storage_path" in d))).toBe(true);
  });

  it("décision : correction avec message obligatoire, refus, dossier clos ensuite ; validation impossible sans profil", async () => {
    const member = await createMember(db, { firstName: "Yélian", sex: "female", status: "registering" });
    const result = await asUser(db, member, async (tx) => {
      const [front, selfie] = await upload(tx, member, "p.jpg", "s.jpg");
      await submit(tx, "passport", front!, null, selfie!);
      await sign(tx, "widowed", false);
      const [ver] = await rows(tx.query<{ id: string }>("select id from app.verifications where user_id = $1", [member]));
      const decide = (status: string, note: string | null) =>
        attempt(tx, "select app.decide_verification($1, $2::app.verification_status, $3)", [ver!.id, status, note]);

      await actAs(tx, admin);
      const steps = {
        noNote: await decide("to_correct", "  "),
        backToPending: await decide("pending", null),
        rejected: await decide("rejected", null),
        afterRejection: await decide("approved", null),
        status: await profileStatus(tx, member),
      };
      // Validation impossible tant que le profil n'existe pas
      await tx.exec("reset role");
      const ghost = (await rows(tx.query<{ id: string }>("insert into auth.users (id) values (gen_random_uuid()) returning id")))[0]!.id;
      const [ghostVer] = await rows(tx.query<{ id: string }>("insert into app.verifications (user_id) values ($1) returning id", [ghost]));
      await tx.exec("set local role authenticated");
      const noProfile = await attempt(tx, "select app.decide_verification($1, 'approved', null)", [ghostVer!.id]);
      return { ...steps, noProfile };
    });
    expect(result.noNote).toMatch(/note_required/);
    expect(result.backToPending).toMatch(/invalid_status/);
    expect(result.rejected).toBeNull();
    expect(result.afterRejection).toMatch(/verification_closed/);
    expect(result.status).toBe("excluded");
    expect(result.noProfile).toMatch(/profile_missing/);
  });

  it("durée du lien vers une pièce : 5 minutes, lisible par l'équipe", async () => {
    const value = await asUser(db, admin, (tx) =>
      rows(tx.query<{ value: unknown }>("select value from app.settings where key = 'safety.signed_id_document_url_seconds'")),
    );
    expect(Number(value[0]?.value)).toBe(300);
  });
});
