import { describe, expect, it } from "vitest";
import { ageOn, filterQueue, memberName, parseQueueFilter, type QueueRow } from "../src/app/[locale]/(admin)/admin/verifications/queue";
import { checkVenue } from "../src/app/[locale]/(admin)/admin/lieux/venues";
import {
  availableActions,
  historyKey,
  type MemberStatus,
  memberQueryParams,
  memberRpcArgs,
  pageCount,
  parseMemberQuery,
} from "../src/app/[locale]/(admin)/admin/membres/members";
import {
  canCheckIn,
  checkDraft,
  DEFAULT_PRICE_XOF,
  draftDefaults,
  type EventStatus,
  filterEvents,
  fromCotonouInput,
  groupParticipants,
  nextStep,
  type ParticipantRow,
  parseEventFilter,
  toCotonouInput,
} from "../src/app/[locale]/(admin)/admin/soirees/evenings";
import { canPrintTables, qrPath, voteUrl } from "../src/app/[locale]/(admin)/admin/soirees/tables";
import { parsePaymentQuery, paymentQueryParams, paymentRpcArgs, providerKey, refundState } from "../src/app/[locale]/(admin)/admin/paiements/payments";
import {
  combineFilters,
  dateRange,
  decodeFilter,
  emptyCondition,
  encodeFilter,
  type FilterGroup,
  formatSort,
  isBuilderFilter,
  isValidFilter,
  parseColumns,
  parseSort,
  pruneFilter,
} from "../src/app/[locale]/(admin)/admin/membres/filters";
import { csvCell, exportColumns, exportFileName, exportTable, toCsv, toXlsx } from "../src/app/[locale]/(admin)/admin/membres/exporting";
import { checkMessage, everyone, targetArgs } from "../src/app/[locale]/(admin)/admin/membres/bulk";
import { isAdminNavActive, visibleAdminNav } from "../src/components/admin/adminNav";
import ExcelJS from "exceljs";
import { groupHits, hitStatusKey, isSearchShortcut, type SearchHit, searchHref } from "../src/components/admin/search";
import QRCode from "qrcode";
import { clock, stepKey, type TimerRound, timerState } from "../src/app/[locale]/(admin)/admin/soirees/timer";

describe("Menu de l'administration (11.1)", () => {
  it("n'affiche que les modules permis au rôle, sans groupe vide", () => {
    // Administration : vérifications, soirées et lieux
    expect(visibleAdminNav(["verifications.review", "members.manage", "events.manage"]).map((g) => g.items.map((i) => i.key))).toEqual([
      ["members", "verifications"],
      ["evenings", "venues", "themes"],
    ]);
    expect(visibleAdminNav(["events.manage"]).map((g) => g.key)).toEqual(["evenings"]);
    expect(visibleAdminNav(["payments.read"]).map((g) => g.items.map((i) => i.href))).toEqual([["/admin/paiements"]]);
    // Modération : relecture des textes seulement, pas de vérification (décisions du 17 et du 22 octobre 2026)
    expect(visibleAdminNav(["profile_texts.review"]).map((g) => g.items.map((i) => i.href))).toEqual([["/admin/moderation"]]);
    expect(visibleAdminNav(["verifications.review", "profile_texts.review"]).map((g) => g.items.map((i) => i.key))).toEqual([["verifications", "moderation"]]);
  });

  it("entrée active sur sa page et ses fiches", () => {
    const [group] = visibleAdminNav(["verifications.review"]);
    const item = group!.items[0]!;
    expect(isAdminNavActive(item, "/admin/verifications")).toBe(true);
    expect(isAdminNavActive(item, "/admin/verifications/abc")).toBe(true);
    expect(isAdminNavActive(item, "/admin")).toBe(false);
  });
});

describe("File des vérifications (11.2-3)", () => {
  const row = (over: Partial<QueueRow>): QueueRow => ({
    verification_id: "v",
    user_id: "u",
    member_number: "W000001",
    first_name: "Afiwa",
    last_name: "Fictif",
    status: "pending",
    submitted_at: null,
    document_kind: "id_card",
    has_selfie: true,
    declared_status: "single",
    ready: true,
    ...over,
  });

  it("filtres lus dans l'adresse ; « complets » : en attente et complets seulement", () => {
    const rows = [row({ verification_id: "a" }), row({ verification_id: "b", ready: false }), row({ verification_id: "c", status: "to_correct" })];
    expect(parseQueueFilter("complets")).toBe("ready");
    expect(parseQueueFilter(["a-corriger"])).toBe("to_correct");
    expect(parseQueueFilter("inconnu")).toBe("all");
    expect(filterQueue(rows, "ready").map((r) => r.verification_id)).toEqual(["a"]);
    expect(filterQueue(rows, "pending").map((r) => r.verification_id)).toEqual(["a", "b"]);
    expect(filterQueue(rows, "to_correct").map((r) => r.verification_id)).toEqual(["c"]);
    expect(filterQueue(rows, "all")).toHaveLength(3);
  });

  it("nom complet pour l'équipe, rien si le profil n'existe pas", () => {
    expect(memberName({ first_name: "Afiwa", last_name: "Fictif" })).toBe("Afiwa Fictif");
    expect(memberName({ first_name: null, last_name: null })).toBeNull();
  });

  it("âge révolu à l'heure de Cotonou, la veille et le jour de l'anniversaire", () => {
    expect(ageOn("1994-05-14", new Date("2026-05-13T12:00:00Z"))).toBe(31);
    expect(ageOn("1994-05-14", new Date("2026-05-14T12:00:00Z"))).toBe(32);
    // 13 mai à 23 h 30 UTC : déjà le 14 mai à Cotonou
    expect(ageOn("1994-05-14", new Date("2026-05-13T23:30:00Z"))).toBe(32);
  });
});

describe("Soirées de l'administration (11.2-5)", () => {
  const ev = (status: EventStatus) => ({ status });

  it("filtres lus dans l'adresse", () => {
    const rows = (["draft", "published", "full", "in_progress", "finished", "cancelled"] as EventStatus[]).map(ev);
    expect(parseEventFilter("brouillons")).toBe("drafts");
    expect(parseEventFilter(["en-cours"])).toBe("live");
    expect(parseEventFilter("inconnu")).toBe("all");
    expect(filterEvents(rows, "upcoming").map((r) => r.status)).toEqual(["published", "full"]);
    expect(filterEvents(rows, "drafts").map((r) => r.status)).toEqual(["draft"]);
    expect(filterEvents(rows, "live").map((r) => r.status)).toEqual(["in_progress"]);
    expect(filterEvents(rows, "past").map((r) => r.status)).toEqual(["finished", "cancelled"]);
    expect(filterEvents(rows, "all")).toHaveLength(6);
  });

  it("déroulé : publier, préparer, commencer, terminer, calculer, puis plus rien", () => {
    expect(nextStep("draft", false, false)).toBe("publish");
    expect(nextStep("published", false, false)).toBe("prepare");
    expect(nextStep("full", true, false)).toBe("start");
    expect(nextStep("in_progress", true, false)).toBe("finish");
    expect(nextStep("finished", true, false)).toBe("compute");
    expect(nextStep("finished", true, true)).toBeNull();
    expect(nextStep("cancelled", false, false)).toBeNull();
  });

  it("pointage : place confirmée, soirée publiée, tables pas encore préparées", () => {
    expect(canCheckIn({ status: "confirmed" }, "published", false)).toBe(true);
    expect(canCheckIn({ status: "booked" }, "published", false)).toBe(false);
    expect(canCheckIn({ status: "confirmed" }, "published", true)).toBe(false);
    expect(canCheckIn({ status: "confirmed" }, "in_progress", false)).toBe(false);
  });

  it("heure de Cotonou (UTC+1) dans les deux sens, dates impossibles refusées", () => {
    expect(fromCotonouInput("2026-11-07T19:30")?.toISOString()).toBe("2026-11-07T18:30:00.000Z");
    expect(fromCotonouInput("2026-01-01T00:15")?.toISOString()).toBe("2025-12-31T23:15:00.000Z");
    expect(toCotonouInput(new Date("2026-11-07T18:30:00Z"))).toBe("2026-11-07T19:30");
    expect(fromCotonouInput("2026-02-31T19:00")).toBeNull();
    expect(fromCotonouInput("07/11/2026 19:30")).toBeNull();
    expect(fromCotonouInput("")).toBeNull();
  });

  it("contrôle du brouillon identique à la base : début futur, 1 à 12 places, durées, tarif", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    const ok = { venueId: null, themeId: null, startsAt: "2026-11-07T19:30", priceXof: null, ...draftDefaults };
    expect(checkDraft(ok, now)).toBeNull();
    expect(checkDraft({ ...ok, startsAt: "" }, now)).toBe("starts_at");
    expect(checkDraft({ ...ok, startsAt: "2026-10-19T11:00" }, now)).toBe("starts_in_past");
    expect(checkDraft({ ...ok, capacityWomen: 13 }, now)).toBe("invalid_capacity");
    expect(checkDraft({ ...ok, capacityMen: Number.NaN }, now)).toBe("invalid_capacity");
    expect(checkDraft({ ...ok, roundMinutes: 0 }, now)).toBe("invalid_duration");
    expect(checkDraft({ ...ok, changeoverMinutes: -1 }, now)).toBe("invalid_duration");
    expect(checkDraft({ ...ok, priceXof: -1 }, now)).toBe("invalid_price");
    expect(checkDraft({ ...ok, priceXof: 5000 }, now)).toBeNull();
    expect(draftDefaults).toEqual({ capacityWomen: 10, capacityMen: 10, roundMinutes: 7, changeoverMinutes: 1 });
    expect(DEFAULT_PRICE_XOF).toBe(10_000);
  });

  it("inscriptions regroupées : places occupées, liste d'attente, puis le reste", () => {
    const p = (user_id: string, sex: "female" | "male", status: ParticipantRow["status"]): ParticipantRow => ({
      user_id,
      sex,
      status,
      member_number: null,
      first_name: null,
      last_name: null,
      waitlist_position: null,
      registered_at: "2026-10-01T10:00:00Z",
      confirmed_at: null,
      checked_in_at: null,
      seat_number: null,
    });
    const rows = [p("a", "female", "confirmed"), p("b", "female", "waitlisted"), p("c", "female", "released"), p("d", "male", "booked")];
    const women = groupParticipants(rows, "female");
    expect([women.seated, women.waiting, women.other].map((g) => g.map((r) => r.user_id))).toEqual([["a"], ["b"], ["c"]]);
    expect(groupParticipants(rows, "male").seated.map((r) => r.user_id)).toEqual(["d"]);
  });
});

describe("Codes QR des tables (11.2-5, question 20)", () => {
  it("adresse <domaine>/vote/<code>, barre finale du domaine ignorée", () => {
    expect(voteUrl("https://wanyiyi.example", "abcdef0123456789")).toBe("https://wanyiyi.example/vote/abcdef0123456789");
    expect(voteUrl("https://wanyiyi.example/", "abcdef0123456789")).toBe("https://wanyiyi.example/vote/abcdef0123456789");
  });

  it("imprimables une fois les tables préparées, jusqu'à la fin de la soirée", () => {
    expect(canPrintTables("published", false)).toBe(false);
    for (const status of ["published", "full", "in_progress"] as const) expect(canPrintTables(status, true)).toBe(true);
    for (const status of ["draft", "finished", "cancelled"] as const) expect(canPrintTables(status, true)).toBe(false);
  });

  it("un carré par module sombre du code, pour un code QR de taille valide", () => {
    const url = voteUrl("https://wanyiyi.example", "abcdef0123456789abcdef0123456789");
    const { size, path } = qrPath(url);
    const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
    expect(size).toBe(modules.size);
    expect((size - 17) % 4).toBe(0);
    expect(path.match(/M/g)?.length).toBe(Array.from(modules.data).filter(Boolean).length);
    expect(path).not.toMatch(/#|rgb/);
  });
});

describe("Filtres avancés des membres (11.3)", () => {
  const nested: FilterGroup = {
    op: "and",
    items: [
      { field: "sex", cmp: "in", value: ["female"] },
      { op: "or", items: [{ field: "age", cmp: "between", value: [25, 35] }, { field: "created_at", cmp: "between", value: ["2026-10-01", null] }] },
    ],
  };

  it("mêmes règles que la base : champ, comparaison, valeur, profondeur, nombre", () => {
    expect(isValidFilter(nested)).toBe(true);
    expect(isValidFilter({ field: "phone; drop", cmp: "contains", value: "1" })).toBe(false);
    expect(isValidFilter({ field: "name", cmp: "equals", value: "x" })).toBe(false);
    expect(isValidFilter({ field: "status", cmp: "in", value: ["inconnu"] })).toBe(false);
    expect(isValidFilter({ field: "age", cmp: "between", value: [null, null] })).toBe(false);
    expect(isValidFilter({ field: "age", cmp: "between", value: [18.5, null] })).toBe(false);
    expect(isValidFilter({ field: "created_at", cmp: "between", value: ["hier", null] })).toBe(false);
    const deep = { op: "and", items: [{ op: "and", items: [{ op: "and", items: [{ op: "and", items: [] }] }] }] };
    expect(isValidFilter(deep)).toBe(false);
    expect(isValidFilter({ op: "and", items: Array.from({ length: 21 }, () => ({ field: "name", cmp: "contains", value: "a" })) })).toBe(false);
  });

  it("adresse : aller-retour du filtre (accents compris) ; paramètre illisible ou trop profond ignoré", () => {
    const withAccent: FilterGroup = { op: "or", items: [{ field: "name", cmp: "contains", value: "Houéfa" }] };
    expect(decodeFilter(encodeFilter(nested))).toEqual(nested);
    expect(decodeFilter(encodeFilter(withAccent))).toEqual(withAccent);
    expect(encodeFilter(nested)).toMatch(/^[\w-]+$/);
    expect(decodeFilter("pas-du-json")).toBeNull();
    expect(decodeFilter(undefined)).toBeNull();
    const twoLevels: FilterGroup = { op: "and", items: [{ op: "or", items: [{ op: "and", items: [{ field: "sanctioned", cmp: "is", value: true }] }] }] };
    expect(decodeFilter(encodeFilter(twoLevels))).toBeNull(); // le constructeur s'arrête à un niveau de sous-groupes
  });

  it("lignes incomplètes et groupes vides retirés avant l'envoi", () => {
    const draft: FilterGroup = {
      op: "and",
      items: [emptyCondition("name"), { op: "or", items: [emptyCondition("status")] }, { field: "sanctioned", cmp: "is", value: false }],
    };
    expect(pruneFilter(draft)).toEqual({ op: "and", items: [{ field: "sanctioned", cmp: "is", value: false }] });
    expect(pruneFilter({ op: "and", items: [emptyCondition("age")] })).toBeNull();
  });

  it("recherche simple ajoutée par un ET, dans les limites de la base", () => {
    const combined = combineFilters({ search: "+229 01 97", status: "verified", role: null, sex: null }, nested)!;
    expect(isValidFilter(combined)).toBe(true);
    expect(combined).toEqual({
      op: "and",
      items: [
        {
          op: "or",
          items: [
            { field: "name", cmp: "contains", value: "+229 01 97" },
            { field: "member_number", cmp: "contains", value: "+229 01 97" },
            { field: "phone", cmp: "contains", value: "2290197" },
          ],
        },
        { field: "status", cmp: "in", value: ["verified"] },
        ...nested.items,
      ],
    });
    // Constructeur plein (un niveau de sous-groupes, 14 conditions) + recherche + filtres rapides
    const full: FilterGroup = { op: "or", items: [{ op: "and", items: Array.from({ length: 14 }, () => ({ field: "city", cmp: "contains", value: "Cotonou" })) }] };
    expect(isBuilderFilter(full)).toBe(true);
    expect(isValidFilter(combineFilters({ search: "12345", status: "verified", role: "member", sex: "male" }, full))).toBe(true);
    expect(combineFilters({ search: "", status: null, role: null, sex: null }, null)).toBeNull();
  });

  it("tri : 3 colonnes au plus, sans doublon ; colonnes affichées, par défaut sinon", () => {
    expect(parseSort("age.desc,name.asc,age.asc,sex.asc,matches.desc,status.asc")).toEqual([
      { field: "age", dir: "desc" },
      { field: "name", dir: "asc" },
      { field: "matches", dir: "desc" },
    ]);
    expect(formatSort(parseSort("age.desc,name.asc"))).toBe("age.desc,name.asc");
    expect(parseSort(undefined)).toEqual([]);
    expect(parseColumns("phone,status,inconnu")).toEqual(["status", "phone"]);
    expect(parseColumns("inconnu")).toEqual(["status", "role", "activity", "joined"]);
  });

  it("raccourcis de dates à l'heure de Cotonou", () => {
    const lateEvening = new Date("2026-10-19T23:30:00Z"); // déjà le 20 à Cotonou
    expect(dateRange("today", lateEvening)).toEqual(["2026-10-20", "2026-10-20"]);
    expect(dateRange("week", lateEvening)).toEqual(["2026-10-14", "2026-10-20"]);
    expect(dateRange("month", lateEvening)).toEqual(["2026-10-01", "2026-10-20"]);
  });
});

describe("Export des membres (11.3, décisions du 19 octobre 2026)", () => {
  const row = {
    user_id: "u1",
    member_number: "W-0001",
    phone: "+22901970000001",
    role: "member",
    first_name: "Ayaba",
    last_name: "Fictif, \"dit\" A",
    sex: "female",
    birth_date: "1990-03-01",
    city: "=HYPERLINK(\"x\")",
    status: "verified",
    created_at: "2026-10-19T10:00:00Z",
    evenings_attended: 4,
    matches: 0,
    total: 1,
  } as const;
  const labels = {
    header: (c: string) => c.toUpperCase(),
    status: (s: string) => `état ${s}`,
    role: (r: string) => `rôle ${r}`,
    sex: (s: string) => `sexe ${s}`,
    date: (iso: string) => iso.slice(0, 10),
    age: () => 36,
  };

  it("colonnes : identité, puis celles de la liste ; téléphone pour la super administration seulement", () => {
    expect(exportColumns(["status", "phone", "activity"], false)).toEqual(["member_number", "first_name", "last_name", "status", "evenings_attended", "matches"]);
    expect(exportColumns(["phone"], true)).toEqual(["member_number", "first_name", "last_name", "phone"]);
  });

  it("CSV : guillemets échappés, formules neutralisées, BOM et fins de ligne CRLF", () => {
    const table = exportTable([row], ["first_name", "last_name", "city", "phone", "status", "matches"], labels);
    const csv = toCsv(table);
    expect(csv.startsWith("\uFEFFFIRST_NAME,LAST_NAME,CITY,PHONE,STATUS,MATCHES\r\n")).toBe(true);
    expect(csv).toContain('Ayaba,"Fictif, ""dit"" A","\'=HYPERLINK(""x"")",\'+22901970000001,état verified,0\r\n');
    expect(csvCell(null)).toBe("");
    expect(csvCell("-1")).toBe("'-1");
    expect(exportFileName("xlsx", "2026-10-19")).toBe("membres-2026-10-19.xlsx");
  });

  it("Excel : fichier lisible, en-tête puis lignes, nombres conservés", async () => {
    const table = exportTable([row], ["member_number", "first_name", "age", "matches"], labels);
    const buffer = await toXlsx(table, "Membres");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Membres")!;
    expect(sheet.getRow(1).values).toEqual([undefined, "MEMBER_NUMBER", "FIRST_NAME", "AGE", "MATCHES"]);
    expect(sheet.getRow(2).values).toEqual([undefined, "W-0001", "Ayaba", 36, 0]);
    expect(sheet.getRow(1).font?.bold).toBe(true);
  }, 30_000);
});

describe("Actions groupées (11.3, décisions du 19 octobre 2026)", () => {
  const id = "0b0f6a52-6f0c-4f4e-9d9a-5c2a9a3f2e11";

  it("cible : membres cochés (200 au plus, identifiants valables, sans doublon) ou résultat du filtre", () => {
    expect(targetArgs({ kind: "selected", ids: [id, id] })).toEqual({ p_targets: [id], p_filter: null });
    expect(targetArgs({ kind: "selected", ids: [] })).toBeNull();
    expect(targetArgs({ kind: "selected", ids: ["pas-un-uuid"] })).toBeNull();
    const many = Array.from({ length: 201 }, (_, i) => `0b0f6a52-6f0c-4f4e-9d9a-${String(i).padStart(12, "0")}`);
    expect(targetArgs({ kind: "selected", ids: many })).toBeNull();
    expect(targetArgs({ kind: "filter", filter: everyone })).toEqual({ p_targets: null, p_filter: { op: "and", items: [] } });
    expect(targetArgs({ kind: "filter", filter: { field: "inconnu" } as unknown as FilterGroup })).toBeNull();
  });

  it("message complet dans les trois langues, 500 caractères au plus chacun", () => {
    const message = { fr: "Bonjour", en: "Hello", yo: "Ẹ n lẹ́" };
    expect(checkMessage(message)).toBeNull();
    expect(checkMessage({ ...message, yo: "  " })).toBe("invalid_message");
    expect(checkMessage({ ...message, en: "x".repeat(501) })).toBe("invalid_message");
  });
});

describe("Recherche globale (11.1)", () => {
  const hit = (kind: SearchHit["kind"], detail: string | null = null, title: string | null = "x"): SearchHit => ({ kind, id: "id1", title, detail, at: null });

  it("chaque résultat ouvre sa page ; un paiement ouvre la liste filtrée sur sa référence", () => {
    expect(searchHref(hit("member"))).toBe("/admin/membres/id1");
    expect(searchHref(hit("verification"))).toBe("/admin/verifications/id1");
    expect(searchHref(hit("evening"))).toBe("/admin/soirees/id1");
    expect(searchHref(hit("venue"))).toBe("/admin/lieux");
    expect(searchHref(hit("payment", null, "sim_42"))).toEqual({ pathname: "/admin/paiements", query: { q: "sim_42" } });
    expect(searchHref(hit("payment", null, null))).toBe("/admin/paiements");
  });

  it("regroupés dans l'ordre des modules, types inconnus ignorés ; états traduits seulement s'ils sont connus", () => {
    const groups = groupHits([hit("payment"), hit("member"), { ...hit("member"), kind: "autre" as SearchHit["kind"] }, hit("evening")]);
    expect(groups.map((g) => [g.kind, g.hits.length])).toEqual([
      ["member", 1],
      ["evening", 1],
      ["payment", 1],
    ]);
    expect(hitStatusKey(hit("verification", "to_correct"))).toBe("verifications.status.to_correct");
    expect(hitStatusKey(hit("evening", "inconnu"))).toBeNull();
    expect(hitStatusKey(hit("member", "W-0001"))).toBeNull();
  });

  it("raccourci : Ctrl+K ou Cmd+K partout ; « / » seulement hors d'un champ", () => {
    const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });
    expect(isSearchShortcut(key("k", { ctrlKey: true }), true)).toBe(true);
    expect(isSearchShortcut(key("K", { metaKey: true }), false)).toBe(true);
    expect(isSearchShortcut(key("/"), false)).toBe(true);
    expect(isSearchShortcut(key("/"), true)).toBe(false);
    expect(isSearchShortcut(key("k"), false)).toBe(false);
    expect(isSearchShortcut(key("k", { ctrlKey: true, altKey: true }), false)).toBe(false);
  });
});

describe("Paiements (11.2-9)", () => {
  it("filtres lus dans l'adresse, valeurs inconnues ignorées, pagination", () => {
    const query = parsePaymentQuery({ q: " sim_1 ", etat: "succeeded", objet: "evening_booking", remboursement: "requested", page: "3" });
    expect(query).toEqual({ search: "sim_1", status: "succeeded", purpose: "evening_booking", refund: "requested", page: 3 });
    expect(paymentRpcArgs(query)).toMatchObject({ p_search: "sim_1", p_refund: "requested", p_limit: 50, p_offset: 100 });
    expect(paymentQueryParams(query, 1)).toEqual({ q: "sim_1", etat: "succeeded", objet: "evening_booking", remboursement: "requested" });
    expect(parsePaymentQuery({ etat: "paid", objet: "x", remboursement: "oui", page: "-2" })).toEqual({ search: "", status: null, purpose: null, refund: null, page: 1 });
  });

  it("remboursement demandé tant que le prestataire ne l'a pas exécuté ; prestataire inconnu générique", () => {
    expect(refundState({ status: "succeeded", refund_requested_at: "2026-10-19T10:00:00Z" })).toBe("requested");
    expect(refundState({ status: "refunded", refund_requested_at: "2026-10-19T10:00:00Z" })).toBe("refunded");
    expect(refundState({ status: "succeeded", refund_requested_at: null })).toBeNull();
    expect(providerKey("simulated")).toBe("simulated");
    expect(providerKey("feexpay")).toBe("feexpay");
    expect(providerKey("autre")).toBe("other");
  });
});

describe("Lieux (11.2-5)", () => {
  it("nom, adresse et ville obligatoires", () => {
    const venue = { name: "Maison Akpakpa (lieu fictif)", address: "Adresse fictive", city: "Cotonou", isPartner: true };
    expect(checkVenue(venue)).toBeNull();
    expect(checkVenue({ ...venue, name: "  " })).toBe("name");
    expect(checkVenue({ ...venue, address: "" })).toBe("address");
    expect(checkVenue({ ...venue, city: "" })).toBe("city");
  });
});

describe("Membres (11.2-2)", () => {
  it("filtres lus dans l'adresse, valeurs inconnues ignorées, pagination", () => {
    const q = parseMemberQuery({ q: "  Afiwa ", etat: "suspended", role: "pirate", sexe: ["female"], page: "3" });
    expect(q).toEqual({ search: "Afiwa", status: "suspended", role: null, sex: "female", page: 3 });
    expect(parseMemberQuery({ page: "-2" }).page).toBe(1);
    expect(memberRpcArgs(q)).toEqual({ p_search: "Afiwa", p_status: "suspended", p_role: null, p_sex: "female", p_limit: 50, p_offset: 100 });
    expect(memberQueryParams(q, 1)).toEqual({ q: "Afiwa", etat: "suspended", sexe: "female" });
    expect(memberQueryParams(q, 4)).toMatchObject({ page: "4" });
    expect([pageCount(0), pageCount(50), pageCount(51)]).toEqual([1, 1, 2]);
  });

  it("actions selon l'état, jamais sur son propre compte ; rôle réservé à la super administration", () => {
    const card = (status: MemberStatus | null) => ({ user_id: "m", status });
    expect(availableActions(card("verified"), "admin", false)).toEqual({ suspend: true, reactivate: false, exclude: true, blockEvenings: true, role: false });
    expect(availableActions(card("suspended"), "admin", true)).toEqual({ suspend: false, reactivate: true, exclude: true, blockEvenings: true, role: true });
    expect(availableActions(card("excluded"), "admin", true)).toEqual({ suspend: false, reactivate: false, exclude: false, blockEvenings: false, role: true });
    expect(availableActions(card("verified"), "m", true)).toMatchObject({ suspend: false, exclude: false, role: false });
    expect(availableActions(card(null), "admin", false)).toMatchObject({ suspend: false, exclude: false, blockEvenings: false });
  });

  it("historique : types connus traduits, les autres génériques", () => {
    expect(historyKey("evening.checked_in")).toBe("evening_checked_in");
    expect(historyKey("sanction.suspension")).toBe("sanction_suspension");
    expect(historyKey("vote.cast")).toBe("other");
  });
});

describe("Minuteur des tours (question 8 : pas de pause)", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 10, 7, 19, 0) + min * 60_000).toISOString();
  // 3 tours de 7 minutes, 1 minute de changement, horaire fixé par la base
  const rounds: TimerRound[] = [
    { round_number: 1, started_at: at(0), ended_at: at(7) },
    { round_number: 2, started_at: at(8), ended_at: at(15) },
    { round_number: 3, started_at: at(16), ended_at: at(23) },
  ];
  const now = (min: number) => new Date(at(min));

  it("tour en cours, changement de table, fin ; rien avant le démarrage", () => {
    expect(timerState(rounds.map((r) => ({ ...r, started_at: null, ended_at: null })), now(0))).toEqual({ phase: "not_started" });
    expect(timerState(rounds, now(-0.5))).toEqual({ phase: "before", untilMs: 30_000 });
    expect(timerState(rounds, now(0))).toEqual({ phase: "round", round: 1, total: 3, remainingMs: 7 * 60_000 });
    expect(timerState(rounds, now(6.5))).toEqual({ phase: "round", round: 1, total: 3, remainingMs: 30_000 });
    expect(timerState(rounds, now(7.25))).toEqual({ phase: "changeover", nextRound: 2, total: 3, remainingMs: 45_000 });
    expect(timerState(rounds, now(16))).toMatchObject({ phase: "round", round: 3 });
    expect(timerState(rounds, now(23))).toEqual({ phase: "finished", total: 3 });
  });

  it("un signal à chaque changement d'étape ; temps affiché en minutes et secondes", () => {
    expect(stepKey(timerState(rounds, now(1)))).toBe("round-1");
    expect(stepKey(timerState(rounds, now(7.5)))).toBe("changeover-2");
    expect(stepKey(timerState(rounds, now(30)))).toBe("finished");
    expect(clock(7 * 60_000)).toBe("7:00");
    expect(clock(30_500)).toBe("0:31");
    expect(clock(-5)).toBe("0:00");
  });
});

