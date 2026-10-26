import { describe, expect, it } from "vitest";
import {
  combineListFilters,
  decodeListFilter,
  emptyListCondition,
  encodeListFilter,
  eventsSpec,
  isBuilderListFilter,
  isValidListFilter,
  listFilterQuery,
  listSpecs,
  moderationSpec,
  parseListColumns,
  parseListPage,
  parseListSort,
  parseListState,
  paymentsSpec,
  pruneListFilter,
  themesSpec,
  venuesSpec,
  verificationsSpec,
} from "../src/components/admin/listRules";
import { venueExportCell, venueExportColumns } from "../src/app/[locale]/(admin)/admin/lieux/venues";
import { themeExportCell, themeExportColumns } from "../src/app/[locale]/(admin)/admin/themes/themes";
import { moderationExportCell, moderationExportColumns } from "../src/app/[locale]/(admin)/admin/moderation/moderation";
import { eventConditions, eventExportCell, eventExportColumns, type AdminEventRow } from "../src/app/[locale]/(admin)/admin/soirees/evenings";
import { paymentConditions, paymentExportCell, paymentExportColumns, type PaymentRow } from "../src/app/[locale]/(admin)/admin/paiements/payments";
import {
  filterQueue,
  parseQueueFilter,
  queueConditions,
  type QueueRow,
  verificationExportCell,
  verificationExportColumns,
  type VerificationListRow,
} from "../src/app/[locale]/(admin)/admin/verifications/queue";

/**
 * Filtres avancés des autres listes (section 11.3) : mêmes règles que la base
 * (app.list_field, app.list_filter_sql, app.list_sort_sql ; migration 20261026000200).
 */

describe("Règles des filtres de listes (11.3)", () => {
  it("chaque champ n'existe que dans sa liste ; valeurs contrôlées par type", () => {
    expect(isValidListFilter(paymentsSpec, { field: "amount", cmp: "between", value: [1000, null] })).toBe(true);
    expect(isValidListFilter(eventsSpec, { field: "amount", cmp: "between", value: [1000, null] })).toBe(false);
    expect(isValidListFilter(paymentsSpec, { field: "amount", cmp: "between", value: [null, null] })).toBe(false);
    expect(isValidListFilter(paymentsSpec, { field: "amount", cmp: "between", value: [1_000_000_000, null] })).toBe(false);
    expect(isValidListFilter(paymentsSpec, { field: "amount", cmp: "between", value: [1.5, null] })).toBe(false);
    expect(isValidListFilter(paymentsSpec, { field: "created_at", cmp: "between", value: ["2026-10-01", null] })).toBe(true);
    expect(isValidListFilter(paymentsSpec, { field: "created_at", cmp: "between", value: ["hier", null] })).toBe(false);
    expect(isValidListFilter(paymentsSpec, { field: "status", cmp: "in", value: ["refunded"] })).toBe(true);
    expect(isValidListFilter(paymentsSpec, { field: "status", cmp: "in", value: ["perdu"] })).toBe(false);
    expect(isValidListFilter(paymentsSpec, { field: "status", cmp: "in", value: [] })).toBe(false);
    expect(isValidListFilter(verificationsSpec, { field: "ready", cmp: "is", value: true })).toBe(true);
    expect(isValidListFilter(verificationsSpec, { field: "ready", cmp: "is", value: "oui" })).toBe(false);
    expect(isValidListFilter(eventsSpec, { field: "venue", cmp: "contains", value: "" })).toBe(false);
    expect(isValidListFilter(eventsSpec, { field: "toString", cmp: "contains", value: "x" })).toBe(false);
  });

  it("profondeur et nombre de conditions : limites de la base et du constructeur", () => {
    const cond = { field: "venue", cmp: "contains", value: "x" };
    // Trois niveaux de groupes au plus, comme la base
    const three = { op: "and", items: [{ op: "and", items: [{ op: "and", items: [cond] }] }] };
    expect(isValidListFilter(eventsSpec, three)).toBe(true);
    expect(isValidListFilter(eventsSpec, { op: "and", items: [three] })).toBe(false);
    expect(isBuilderListFilter(eventsSpec, { op: "and", items: [{ op: "or", items: [cond, cond] }] })).toBe(true);
    expect(isBuilderListFilter(eventsSpec, { op: "and", items: [{ op: "or", items: [{ op: "and", items: [cond] }] }] })).toBe(false);
    expect(isBuilderListFilter(eventsSpec, { op: "and", items: Array(15).fill(cond) })).toBe(false);
  });

  it("condition vide selon le type ; lignes incomplètes retirées avant l'envoi", () => {
    expect(emptyListCondition(paymentsSpec, "member")).toEqual({ field: "member", cmp: "contains", value: "" });
    expect(emptyListCondition(paymentsSpec, "provider")).toEqual({ field: "provider", cmp: "in", value: [] });
    expect(emptyListCondition(paymentsSpec, "amount")).toEqual({ field: "amount", cmp: "between", value: [null, null] });
    expect(emptyListCondition(paymentsSpec, "reconciled")).toEqual({ field: "reconciled", cmp: "is", value: true });
    const draft = {
      op: "and" as const,
      items: [emptyListCondition(paymentsSpec, "member"), { field: "amount", cmp: "between" as const, value: [500, null] as [number, null] }, { op: "or" as const, items: [] }],
    };
    expect(pruneListFilter(paymentsSpec, draft)).toEqual({ op: "and", items: [{ field: "amount", cmp: "between", value: [500, null] }] });
    expect(pruneListFilter(paymentsSpec, { op: "and", items: [emptyListCondition(paymentsSpec, "member")] })).toBeNull();
  });

  it("adresse : filtre encodé, relu seulement s'il respecte les règles de la liste", () => {
    const filter = { op: "and" as const, items: [{ field: "venue", cmp: "contains" as const, value: "Akpakpa é" }] };
    const param = encodeListFilter(filter);
    expect(decodeListFilter(eventsSpec, param)).toEqual(filter);
    expect(decodeListFilter(paymentsSpec, param)).toBeNull();
    expect(decodeListFilter(eventsSpec, "pas du json")).toBeNull();
    expect(decodeListFilter(eventsSpec, undefined)).toBeNull();
  });

  it("tri (3 colonnes, sans doublon, liste blanche), colonnes, page", () => {
    expect(parseListSort(paymentsSpec, "amount.desc,amount.asc,venue.asc,created_at.asc,member.asc,status.asc")).toEqual([
      { field: "amount", dir: "desc" },
      { field: "created_at", dir: "asc" },
      { field: "member", dir: "asc" },
    ]);
    expect(parseListColumns(eventsSpec, "price,phone")).toEqual(["price"]);
    expect(parseListColumns(eventsSpec, "phone")).toEqual(["status", "women", "men", "matches"]);
    expect(parseListColumns(verificationsSpec, "submitted,status")).toEqual(["status", "submitted"]);
    expect(parseListPage({ page: "3" })).toBe(3);
    expect(parseListPage({ page: "-2" })).toBe(1);
    const state = parseListState(paymentsSpec, { tri: "amount.desc", colonnes: "amount" });
    expect(state).toEqual({ filter: null, sort: [{ field: "amount", dir: "desc" }], columns: ["amount"] });
    expect(listFilterQuery(paymentsSpec, { q: "x" }, null, state.sort, state.columns)).toEqual({ q: "x", tri: "amount.desc", colonnes: "amount" });
    expect(listFilterQuery(eventsSpec, {}, null, [], [...eventsSpec.defaultColumns])).toEqual({});
  });

  it("les options des listes sont celles des types de la base", () => {
    expect(paymentsSpec.fields.provider!.options).toEqual(["simulated", "fedapay", "kkiapay", "feexpay"]);
    expect(verificationsSpec.fields.document_kind!.options).not.toContain("selfie");
    for (const spec of Object.values(listSpecs)) {
      for (const field of spec.sortFields) expect(spec.fields[field], `${spec.list}.${field}`).toBeDefined();
      for (const [name, field] of Object.entries(spec.fields)) {
        if (field.kind === "list") expect(field.labels, `${spec.list}.${name}`).toBeTruthy();
      }
    }
  });
});

describe("Filtres rapides en conditions (11.3)", () => {
  it("paiements : recherche sur nom, numéro ou référence ; état, objet, remboursement", () => {
    const quick = paymentConditions({ search: "FX-1", status: "succeeded", purpose: null, refund: "requested", page: 1 });
    expect(quick).toEqual([
      {
        op: "or",
        items: [
          { field: "member", cmp: "contains", value: "FX-1" },
          { field: "member_number", cmp: "contains", value: "FX-1" },
          { field: "reference", cmp: "contains", value: "FX-1" },
        ],
      },
      { field: "status", cmp: "in", value: ["succeeded"] },
      { field: "refund", cmp: "in", value: ["requested"] },
    ]);
    for (const node of quick) expect(isValidListFilter(paymentsSpec, node, 1)).toBe(true);
  });

  it("vérifications : « Tous » reste la file, « Traités » montre les décisions", () => {
    expect(queueConditions(parseQueueFilter(undefined))).toEqual([{ field: "status", cmp: "in", value: ["pending", "to_correct"] }]);
    expect(queueConditions(parseQueueFilter("traites"))).toEqual([{ field: "status", cmp: "in", value: ["approved", "rejected"] }]);
    expect(queueConditions(parseQueueFilter("complets"))).toEqual([
      { field: "status", cmp: "in", value: ["pending"] },
      { field: "ready", cmp: "is", value: true },
    ]);
    const row = (status: QueueRow["status"]) => ({ status, ready: true }) as QueueRow;
    expect(filterQueue([row("approved"), row("pending")], "all").map((r) => r.status)).toEqual(["pending"]);
    expect(filterQueue([row("approved"), row("rejected"), row("pending")], "processed").map((r) => r.status)).toEqual(["approved", "rejected"]);
  });

  it("soirées : onglet en états ; un filtre avancé ET se fond dans la liste", () => {
    expect(eventConditions("all")).toEqual([]);
    expect(eventConditions("upcoming")).toEqual([{ field: "status", cmp: "in", value: ["published", "full"] }]);
    const advanced = { op: "and" as const, items: [{ field: "price", cmp: "between" as const, value: [5000, null] as [number, null] }] };
    expect(combineListFilters(eventConditions("upcoming"), advanced)).toEqual({
      op: "and",
      items: [{ field: "status", cmp: "in", value: ["published", "full"] }, advanced.items[0]],
    });
    expect(combineListFilters([], null)).toBeNull();
    expect(combineListFilters([], { op: "or", items: advanced.items })).toEqual({ op: "or", items: advanced.items });
  });
});

describe("Export des listes (11.3)", () => {
  const date = (iso: string) => iso.slice(0, 10);

  it("paiements : montants en nombres, libellés traduits, soirée facultative", () => {
    const row = {
      created_at: "2026-10-20T10:00:00Z",
      member_number: "W-0001",
      first_name: "Ayaba",
      last_name: "Fictif",
      purpose: "evening_booking",
      status: "succeeded",
      provider: "feexpay",
      provider_transaction_id: "FX-1",
      amount_xof: 10000,
      refunded_amount_xof: 0,
      event_starts_at: null,
    } as unknown as PaymentRow;
    const labels = { purpose: (p: string) => `objet:${p}`, status: (s: string) => `état:${s}`, provider: (p: string) => `presta:${p}`, date };
    expect(paymentExportColumns.map((c) => paymentExportCell(row, c, labels))).toEqual([
      "2026-10-20",
      "W-0001",
      "Ayaba",
      "Fictif",
      "objet:evening_booking",
      "état:succeeded",
      "presta:feexpay",
      "FX-1",
      10000,
      0,
      null,
    ]);
  });

  it("vérifications : aucun chemin de pièce, oui / non traduits", () => {
    const row = {
      member_number: "W-0002",
      first_name: "Houéfa",
      last_name: "Fictif",
      sex: "female",
      age: 27,
      status: "pending",
      ready: true,
      document_kind: "passport",
      has_selfie: false,
      declared_status: "divorced",
      submitted_at: "2026-10-21T08:00:00Z",
      decided_at: null,
    } as unknown as VerificationListRow;
    const labels = {
      status: (s: string) => s,
      sex: (s: string) => s,
      kind: (k: string) => k,
      declared: (d: string) => d,
      yesNo: (b: boolean) => (b ? "oui" : "non"),
      date,
    };
    const cells = verificationExportColumns.map((c) => verificationExportCell(row, c, labels));
    expect(cells).toEqual(["W-0002", "Houéfa", "Fictif", "female", 27, "pending", "oui", "passport", "non", "divorced", "2026-10-21", null]);
    expect(verificationExportColumns.join(",")).not.toMatch(/path|storage/);
  });

  it("soirées : places par sexe et matchs en nombres", () => {
    const row = {
      starts_at: "2026-11-01T18:00:00Z",
      status: "published",
      venue_name: "Lieu fictif",
      theme_key: null,
      price_xof: 10000,
      capacity_women: 10,
      taken_women: 8,
      waiting_women: 1,
      capacity_men: 10,
      taken_men: 10,
      waiting_men: 3,
      matches: 0,
    } as AdminEventRow;
    expect(eventExportColumns.map((c) => eventExportCell(row, c, { status: (s) => s, date }))).toEqual([
      "2026-11-01",
      "published",
      "Lieu fictif",
      null,
      10000,
      10,
      8,
      1,
      10,
      10,
      3,
      0,
    ]);
  });
});

describe("Listes Lieux, Thèmes et Modération (question 32)", () => {
  it("champs de chaque liste seulement ; rubrique de texte contrôlée", () => {
    expect(isValidListFilter(venuesSpec, { field: "city", cmp: "contains", value: "Porto" })).toBe(true);
    expect(isValidListFilter(themesSpec, { field: "city", cmp: "contains", value: "Porto" })).toBe(false);
    expect(isValidListFilter(themesSpec, { field: "min_age", cmp: "between", value: [25, null] })).toBe(true);
    expect(isValidListFilter(moderationSpec, { field: "field", cmp: "in", value: ["who_i_am"] })).toBe(true);
    expect(isValidListFilter(moderationSpec, { field: "field", cmp: "in", value: ["autre"] })).toBe(false);
    expect(parseListColumns(venuesSpec, undefined)).toEqual(["address", "city"]);
    expect(parseListSort(moderationSpec, "created_at.desc,body.asc")).toEqual([{ field: "created_at", dir: "desc" }]);
  });

  it("export : lieux, thèmes (libellés du catalogue), textes", () => {
    const date = (iso: string) => iso.slice(0, 10);
    const venue = { id: "v", name: "Lieu fictif", address: "Adresse fictive", city: "Cotonou", is_partner: true, events: 2, created_at: "2026-10-01T00:00:00Z", total: 1 };
    expect(venueExportColumns.map((c) => venueExportCell(venue, c, { yesNo: (b) => (b ? "oui" : "non"), date }))).toEqual([
      "Lieu fictif",
      "Adresse fictive",
      "Cotonou",
      "oui",
      2,
      "2026-10-01",
    ]);
    const theme = {
      id: "t",
      key: "foi",
      name: { fr: "Foi chrétienne" },
      min_age: null,
      max_age: 45,
      required_religions: ["catholic", "protestant"],
      sectors: null,
      events: 0,
      created_at: "2026-10-24T00:00:00Z",
      total: 1,
    };
    const labels = { name: (r: { name: unknown }) => (r.name as { fr: string }).fr, religion: (r: string) => r.toUpperCase(), sector: (s: string) => s, date };
    expect(themeExportColumns.map((c) => themeExportCell(theme, c, labels))).toEqual(["Foi chrétienne", null, 45, "CATHOLIC, PROTESTANT", null, 0, "2026-10-24"]);
    const text = { text_id: "x", user_id: "u", first_name: "Ayaba", member_number: "W-1", field: "who_i_am" as const, body: "Bonjour", created_at: "2026-10-26T09:00:00Z", total: 1 };
    expect(moderationExportColumns.map((c) => moderationExportCell(text, c, { field: (f) => `rubrique:${f}`, date }))).toEqual([
      "W-1",
      "Ayaba",
      "rubrique:who_i_am",
      "Bonjour",
      "2026-10-26",
    ]);
  });
});
