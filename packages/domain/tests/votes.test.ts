import { describe, expect, it } from "vitest";
import { cotonouDate } from "../src/time";
import {
  areMatchesAnnounced,
  castVote,
  computeMatches,
  isQrValid,
  matchAnnouncementAt,
  matchesFor,
  type Participant,
  type Vote,
  VoteError,
} from "../src/votes";

const evening = { startsAt: cotonouDate(2026, 10, 22, 19, 30), endsAt: cotonouDate(2026, 10, 22, 21, 30) };
const during = cotonouDate(2026, 10, 22, 20, 0);

const participants: Participant[] = [
  { memberId: "afiwa", sex: "female", checkedIn: true },
  { memberId: "sena", sex: "female", checkedIn: true },
  { memberId: "koffi", sex: "male", checkedIn: true },
  { memberId: "dossou", sex: "male", checkedIn: true },
  { memberId: "absent", sex: "male", checkedIn: false },
];

const vote = (voterId: string, targetId: string, wantsToSeeAgain: boolean): Vote => ({
  voterId,
  targetId,
  wantsToSeeAgain,
  updatedAt: during,
});

describe("Code QR (9.3)", () => {
  it("valable uniquement pendant la soirée", () => {
    expect(isQrValid(evening, cotonouDate(2026, 10, 22, 19, 29))).toBe(false);
    expect(isQrValid(evening, during)).toBe(true);
    expect(isQrValid(evening, cotonouDate(2026, 10, 22, 21, 31))).toBe(false);
  });
});

describe("Vote (9.3)", () => {
  it("un vote est modifiable jusqu'à la fin de la soirée, puis refusé", () => {
    let votes = castVote(evening, participants, [], vote("afiwa", "koffi", false), during);
    votes = castVote(evening, participants, votes, vote("afiwa", "koffi", true), cotonouDate(2026, 10, 22, 21, 0));
    expect(votes).toHaveLength(1);
    expect(votes[0]!.wantsToSeeAgain).toBe(true);
    expect(() => castVote(evening, participants, votes, vote("afiwa", "koffi", false), cotonouDate(2026, 10, 22, 21, 31))).toThrow(
      VoteError,
    );
  });

  it("refuse le vote d'un absent, pour un absent, pour soi-même ou pour une personne du même sexe", () => {
    const attempt = (v: Vote) => {
      try {
        castVote(evening, participants, [], v, during);
        return null;
      } catch (e) {
        return (e as VoteError).reason;
      }
    };
    expect(attempt(vote("absent", "afiwa", true))).toBe("voter_absent");
    expect(attempt(vote("afiwa", "absent", true))).toBe("target_absent");
    expect(attempt(vote("afiwa", "afiwa", true))).toBe("self");
    expect(attempt(vote("afiwa", "sena", true))).toBe("same_sex");
  });

  it("l'appréciation facultative est conservée pour l'équipe", () => {
    const votes = castVote(evening, participants, [], { ...vote("afiwa", "koffi", true), appreciation: { respect: 5 } }, during);
    expect(votes[0]!.appreciation).toEqual({ respect: 5 });
  });
});

describe("Matchs (9.3)", () => {
  const votes = [
    vote("afiwa", "koffi", true),
    vote("koffi", "afiwa", true),
    vote("sena", "koffi", true),
    vote("koffi", "sena", false),
    vote("afiwa", "dossou", false),
    vote("dossou", "afiwa", true),
  ];

  it("match uniquement si les deux ont dit oui", () => {
    expect(computeMatches(votes)).toEqual([{ memberA: "afiwa", memberB: "koffi" }]);
  });

  it("personne ne voit qui a dit non : un membre ne reçoit que ses matchs", () => {
    const matches = computeMatches(votes);
    expect(matchesFor("afiwa", matches)).toEqual(["koffi"]);
    expect(matchesFor("sena", matches)).toEqual([]);
    expect(matchesFor("dossou", matches)).toEqual([]);
  });

  it("annonce le lendemain à 8 h, heure de Cotonou (7 h UTC)", () => {
    const at = matchAnnouncementAt(evening);
    expect(at.toISOString()).toBe("2026-10-23T07:00:00.000Z");
    expect(areMatchesAnnounced(evening, new Date(at.getTime() - 1))).toBe(false);
    expect(areMatchesAnnounced(evening, at)).toBe(true);
  });

  it("une soirée qui finit après minuit reste annoncée le lendemain de son début", () => {
    const late = { startsAt: cotonouDate(2026, 12, 31, 22, 0), endsAt: cotonouDate(2027, 1, 1, 0, 30) };
    expect(matchAnnouncementAt(late).toISOString()).toBe("2027-01-01T07:00:00.000Z");
  });
});
