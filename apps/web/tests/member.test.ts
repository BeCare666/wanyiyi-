import { describe, expect, it } from "vitest";
import fr from "../messages/fr.json";
import {
  type Evening,
  eveningActions,
  filterEvenings,
  freeSeats,
  groupByMonth,
  type MyBooking,
  parseFilter,
} from "../src/app/[locale]/(membre)/espace/soirees/evenings";
import { defaultRound, isQrToken, parseVote, type Round } from "../src/app/[locale]/(membre)/vote/[qr]/vote";
import { isMemberNavActive, memberNav, memberPrimary } from "../src/components/member/memberNav";
import { notificationHref, notificationKey } from "../src/components/member/notificationKinds";
import { channelsFrom, isChannel, isLocale } from "../src/app/[locale]/(membre)/espace/parametres/settings";
import {
  canSubmit,
  fileError,
  MAX_FILE_BYTES,
  type MyVerification,
  parseDeclaration,
  requiredSlots,
  storagePath,
} from "../src/app/[locale]/(membre)/espace/verification/verification";
import { safeNextPath, signInHref } from "../src/lib/next-path";
import { normalizePhone } from "../src/lib/phone";

describe("Retour après connexion", () => {
  it("accepte une adresse interne", () => {
    expect(safeNextPath("/vote/abc")).toBe("/vote/abc");
    expect(safeNextPath(["/espace/matchs", "/autre"])).toBe("/espace/matchs");
  });

  it("refuse toute redirection vers un autre site", () => {
    for (const value of ["https://exemple.com", "//exemple.com", "/\\exemple.com", "espace", "", undefined, null]) {
      expect(safeNextPath(value)).toBe("/espace");
    }
  });

  it("encode la page à rouvrir", () => {
    expect(signInHref("/vote/abc?x=1")).toBe("/connexion?suite=%2Fvote%2Fabc%3Fx%3D1");
  });
});

describe("Numéro de téléphone", () => {
  it("normalise un numéro international saisi avec des espaces", () => {
    expect(normalizePhone("+229 01 97 00 00 00")).toBe("+2290197000000");
  });

  it("refuse un numéro sans indicatif ou trop court", () => {
    expect(normalizePhone("0197000000")).toBeNull();
    expect(normalizePhone("+229")).toBeNull();
    expect(normalizePhone("+0229019700")).toBeNull();
  });
});

describe("Vote au code QR (9.3)", () => {
  it("n'accepte que les codes générés par la base (hexadécimal)", () => {
    expect(isQrToken("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2")).toBe(true);
    expect(isQrToken("../admin")).toBe(false);
    expect(isQrToken("ABC")).toBe(false);
  });

  it("garde le choix et les notes de 1 à 5, ignore les notes absentes", () => {
    expect(parseVote({ choice: "yes", respect: 5, punctuality: null })).toEqual({ choice: "yes", respect: 5 });
    expect(parseVote({ choice: "no" })).toEqual({ choice: "no" });
  });

  it("refuse un choix inconnu ou une note hors bornes", () => {
    expect(parseVote({ choice: "maybe" as "yes" })).toBeNull();
    expect(parseVote({ choice: "yes", seriousness: 6 })).toBeNull();
    expect(parseVote({ choice: "yes", respect: 2.5 })).toBeNull();
  });

  it("ouvre le premier tour sans vote, en sautant les pauses", () => {
    const rounds: Round[] = [
      { round_number: 1, is_pause: false, my_choice: "yes" },
      { round_number: 2, is_pause: true, my_choice: null },
      { round_number: 3, is_pause: false, my_choice: null },
    ];
    expect(defaultRound(rounds)).toBe(3);
    expect(defaultRound(rounds.map((r) => ({ ...r, my_choice: r.is_pause ? null : "no" })))).toBe(3);
    expect(defaultRound([])).toBeNull();
  });
});

describe("Navigation de l'espace membre (6.1)", () => {
  it("compte 4 sections principales pour la barre basse", () => {
    expect(memberPrimary.map((i) => i.key)).toEqual(["dashboard", "evenings", "matches", "profile"]);
  });

  it("le tableau de bord n'est actif que sur sa propre page", () => {
    expect(isMemberNavActive(memberNav.dashboard, "/espace")).toBe(true);
    expect(isMemberNavActive(memberNav.dashboard, "/espace/matchs")).toBe(false);
    expect(isMemberNavActive(memberNav.matches, "/espace/matchs")).toBe(true);
    expect(isMemberNavActive(memberNav.evenings, "/espace/soirees/123")).toBe(true);
    expect(isMemberNavActive(memberNav.evenings, "/espace/soireesx")).toBe(false);
  });
});

describe("Soirées de l'espace membre (6.2-4)", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const evening = (over: Partial<Evening> & { mine?: MyBooking | null } = {}): Evening => ({
    id: "e1",
    starts_at: "2026-10-24T18:30:00Z",
    status: "published",
    price_xof: null,
    capacity_women: 10,
    capacity_men: 10,
    round_minutes: 7,
    theme: null,
    venue: null,
    seats: [
      { sex: "female", capacity: 10, taken: 10, waiting: 2 },
      { sex: "male", capacity: 10, taken: 4, waiting: 0 },
    ],
    mine: null,
    ...over,
  });
  const booking = (over: Partial<MyBooking>): MyBooking => ({
    status: "booked",
    waitlist_rank: null,
    confirm_by: "2026-10-22T18:30:00Z",
    paid: false,
    ...over,
  });

  it("places restantes par sexe, jamais négatives", () => {
    expect(freeSeats(evening(), "female")).toBe(0);
    expect(freeSeats(evening(), "male")).toBe(6);
    expect(freeSeats(evening({ seats: [{ sex: "male", capacity: 2, taken: 3, waiting: 0 }] }), "male")).toBe(0);
  });

  it("réserver ou rejoindre la liste d'attente selon les places du sexe du membre ; rien sans sexe connu", () => {
    expect(eveningActions(evening(), "male", now)).toEqual(["book"]);
    expect(eveningActions(evening(), "female", now)).toEqual(["waitlist"]);
    expect(eveningActions(evening(), null, now)).toEqual([]);
    // Une place libérée faute de confirmation permet de se réinscrire
    expect(eveningActions(evening({ mine: booking({ status: "released" }) }), "male", now)).toEqual(["book"]);
  });

  it("confirmer avant la limite seulement ; payer si un tarif existe et que rien n'est payé ; annuler", () => {
    expect(eveningActions(evening({ mine: booking({}) }), "female", now)).toEqual(["confirm", "cancel"]);
    expect(eveningActions(evening({ mine: booking({}) }), "female", new Date("2026-10-23T00:00:00Z"))).toEqual(["cancel"]);
    expect(eveningActions(evening({ price_xof: 1, mine: booking({}) }), "female", now)).toEqual(["confirm", "pay", "cancel"]);
    expect(eveningActions(evening({ price_xof: 1, mine: booking({ status: "confirmed", paid: true }) }), "female", now)).toEqual(["cancel"]);
    expect(eveningActions(evening({ mine: booking({ status: "waitlisted", waitlist_rank: 2 }) }), "female", now)).toEqual(["cancel"]);
    expect(eveningActions(evening({ mine: booking({ status: "checked_in" }) }), "female", now)).toEqual([]);
  });

  it("filtres : toutes, mes soirées (sans les places libérées), places disponibles pour mon sexe", () => {
    const list = [
      evening({ id: "a" }),
      evening({ id: "b", mine: booking({}) }),
      evening({ id: "c", mine: booking({ status: "released" }) }),
    ];
    expect(parseFilter("mine")).toBe("mine");
    expect(parseFilter(["available"])).toBe("available");
    expect(parseFilter("autre")).toBe("all");
    expect(filterEvenings(list, "all", "female").map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(filterEvenings(list, "mine", "female").map((e) => e.id)).toEqual(["b"]);
    expect(filterEvenings(list, "available", "female")).toEqual([]);
    expect(filterEvenings(list, "available", "male")).toHaveLength(3);
    expect(filterEvenings(list, "available", null)).toEqual([]);
  });

  it("calendrier par mois à l'heure de Cotonou, dans l'ordre chronologique", () => {
    const groups = groupByMonth([
      evening({ id: "nov", starts_at: "2026-11-07T18:30:00Z" }),
      // 31 octobre à 23 h 30 UTC : déjà le 1er novembre à Cotonou (UTC+1)
      evening({ id: "limite", starts_at: "2026-10-31T23:30:00Z" }),
      evening({ id: "oct", starts_at: "2026-10-24T18:30:00Z" }),
    ]);
    expect(groups.map((g) => [g.month, g.evenings.map((e) => e.id)])).toEqual([
      ["2026-10", ["oct"]],
      ["2026-11", ["limite", "nov"]],
    ]);
  });
});

describe("Notifications", () => {
  it("chaque type connu a son texte et sa page ; un type inconnu reste générique, sans lien", () => {
    expect(notificationKey("evening.seat_offered")).toBe("evening_seat_offered");
    expect(notificationHref("evening.seat_offered")).toEqual({ pathname: "/espace/soirees", query: { filtre: "mine" } });
    expect(notificationHref("match.announced")).toEqual({ pathname: "/espace/matchs" });
    expect(notificationKey("autre.type")).toBe("other");
    expect(notificationHref("autre.type")).toBeNull();
    // « constructor » ne doit pas être pris pour un type connu
    expect(notificationKey("constructor")).toBe("other");
  });
});

describe("Paramètres (6.2-9)", () => {
  it("un canal sans ligne en base reste actif ; les canaux inconnus sont ignorés", () => {
    expect(channelsFrom([])).toEqual({ in_app: true, whatsapp: true, sms: true });
    expect(channelsFrom([{ channel: "sms", enabled: false }, { channel: "email", enabled: false }])).toEqual({
      in_app: true,
      whatsapp: true,
      sms: false,
    });
  });

  it("n'accepte que les langues et canaux prévus", () => {
    expect(["fr", "en", "yo"].every(isLocale)).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isChannel("whatsapp")).toBe(true);
    expect(isChannel("email")).toBe(false);
  });
});

describe("Vérification (6.2-2)", () => {
  it("carte et permis : recto, verso et selfie ; passeport : page photo et selfie", () => {
    expect(requiredSlots("id_card")).toEqual(["front", "back", "selfie"]);
    expect(requiredSlots("driving_licence")).toEqual(["front", "back", "selfie"]);
    expect(requiredSlots("passport")).toEqual(["front", "selfie"]);
  });

  it("fichiers : photo ou PDF pour la pièce, photo seulement pour le selfie, 10 Mo au maximum", () => {
    expect(fileError("front", { type: "application/pdf", size: 1000 })).toBeNull();
    expect(fileError("selfie", { type: "application/pdf", size: 1000 })).toBe("type");
    expect(fileError("selfie", { type: "image/jpeg", size: 1000 })).toBeNull();
    expect(fileError("back", { type: "image/gif", size: 1000 })).toBe("type");
    expect(fileError("front", { type: "image/png", size: MAX_FILE_BYTES + 1 })).toBe("size");
  });

  it("chemin dans le dossier du membre, sans le nom d'origine du fichier", () => {
    expect(storagePath("u1", "image/jpeg", "abc")).toBe("u1/abc.jpg");
    expect(storagePath("u1", "application/pdf", "abc")).toBe("u1/abc.pdf");
  });

  it("déclaration : situation prévue, « autre » précisé, enfants indiqués, case cochée", () => {
    const base = { status: "single", hasChildren: false, otherDetails: "", certified: true };
    expect(parseDeclaration(base)).toEqual({ ok: true, value: { status: "single", hasChildren: false, otherDetails: null } });
    expect(parseDeclaration({ ...base, status: "married" })).toEqual({ ok: false, error: "status" });
    expect(parseDeclaration({ ...base, status: "other", otherDetails: "  " })).toEqual({ ok: false, error: "otherDetails" });
    expect(parseDeclaration({ ...base, status: "other", otherDetails: "x".repeat(301) })).toEqual({ ok: false, error: "otherDetails" });
    expect(parseDeclaration({ ...base, hasChildren: null })).toEqual({ ok: false, error: "children" });
    expect(parseDeclaration({ ...base, certified: false })).toEqual({ ok: false, error: "certify" });
    // Une précision saisie puis abandonnée (situation changée) n'est pas envoyée
    expect(parseDeclaration({ ...base, otherDetails: "texte" })).toMatchObject({ ok: true, value: { otherDetails: null } });
    expect(parseDeclaration({ ...base, status: "other", otherDetails: " Marié coutumièrement " })).toMatchObject({
      ok: true,
      value: { otherDetails: "Marié coutumièrement" },
    });
  });

  it("dépôt possible tant que le dossier n'est pas tranché", () => {
    const v = (status: MyVerification["status"]) => ({ status }) as MyVerification;
    expect(canSubmit(null)).toBe(true);
    expect(canSubmit(v("pending"))).toBe(true);
    expect(canSubmit(v("to_correct"))).toBe(true);
    expect(canSubmit(v("approved"))).toBe(false);
    expect(canSubmit(v("rejected"))).toBe(false);
  });
});

describe("Notifications de l'équipe (19 octobre 2026)", () => {
  it("suspension, réactivation, exclusion : texte connu, sans page associée", () => {
    for (const kind of ["member.suspended", "member.reactivated", "member.excluded"]) {
      expect(notificationKey(kind)).toBe(kind.replace(".", "_"));
      expect(notificationHref(kind)).toBeNull();
    }
  });

  it("soirée publiée modifiée ou annulée : texte connu, lien vers mes soirées", () => {
    for (const kind of ["evening.updated", "evening.cancelled"]) {
      expect(notificationKey(kind)).toBe(kind.replace(".", "_"));
      expect(notificationHref(kind)).toEqual({ pathname: "/espace/soirees", query: { filtre: "mine" } });
    }
  });

  it("chaque type écrit par la base a son texte dans la cloche", () => {
    const kinds = ["evening.seat_offered", "match.announced", "evening.updated", "evening.cancelled", "member.suspended", "member.reactivated", "member.excluded"];
    for (const kind of kinds) expect(Object.keys(fr.Member.bell.kinds)).toContain(notificationKey(kind));
  });
});
