/**
 * Conseiller du couple (section 9.6 ; question 9, réponses de l'utilisateur du 26 octobre 2026) :
 *   - l'un OU l'autre des deux membres invite un conseiller (sa demande vaut son accord) ; l'autre
 *     est prévenu dans le chat et accepte ou refuse ;
 *   - une fois les deux d'accord, l'administration attribue le conseiller : il entre alors dans
 *     le chat du couple, où il lit et écrit ;
 *   - il lit à partir de son arrivée, l'historique seulement si les deux l'ont accepté ;
 *   - chacun peut retirer le conseiller à tout moment, effet immédiat ;
 *   - le canal privé individuel ne montre que ce que le membre écrit au conseiller.
 */

export type AccessStatus = "requested" | "granted" | "refused" | "revoked";

export type CounselorAccess = {
  coupleMembers: readonly [string, string];
  requestedBy: string;
  status: AccessStatus;
  /** Accord de l'autre membre : la demande attend alors l'attribution par l'administration. */
  acceptedAt: Date | null;
  counselorId: string | null;
  grantedAt: Date | null;
  /** Choix de chacun sur l'historique. */
  historyConsents: Readonly<Record<string, boolean>>;
};

export type AccessRefusal = "not_member" | "not_pending" | "own_request" | "not_accepted";

/** Invitation par l'un des deux : la personne qui invite donne déjà son accord. */
export function requestAccess(coupleMembers: readonly [string, string], memberId: string, includeHistory: boolean): CounselorAccess | AccessRefusal {
  if (!coupleMembers.includes(memberId)) return "not_member";
  return {
    coupleMembers,
    requestedBy: memberId,
    status: "requested",
    acceptedAt: null,
    counselorId: null,
    grantedAt: null,
    historyConsents: { [memberId]: includeHistory },
  };
}

/** Réponse de l'autre membre : accord (avec son choix sur l'historique) ou refus. */
export function answerAccess(access: CounselorAccess, memberId: string, accept: boolean, includeHistory: boolean, now: Date): CounselorAccess | AccessRefusal {
  if (!access.coupleMembers.includes(memberId)) return "not_member";
  if (access.status !== "requested" || access.acceptedAt) return "not_pending";
  if (memberId === access.requestedBy) return "own_request";
  if (!accept) return { ...access, status: "refused" };
  return { ...access, acceptedAt: now, historyConsents: { ...access.historyConsents, [memberId]: includeHistory } };
}

/** Attribution du conseiller par l'administration, seulement après l'accord des deux. */
export function assignCounselor(access: CounselorAccess, counselorId: string, now: Date): CounselorAccess | AccessRefusal {
  if (access.status !== "requested") return "not_pending";
  if (!access.acceptedAt) return "not_accepted";
  return { ...access, status: "granted", counselorId, grantedAt: now };
}

/** Retrait par l'un ou l'autre, à tout moment, effet immédiat. */
export function revokeAccess(access: CounselorAccess, memberId: string): CounselorAccess | AccessRefusal {
  if (!access.coupleMembers.includes(memberId)) return "not_member";
  if (access.status !== "granted" && access.status !== "requested") return "not_pending";
  return { ...access, status: "revoked" };
}

/**
 * Messages du couple lisibles par le conseiller : aucun sans attribution ; depuis son arrivée,
 * ou toute la conversation si les deux ont accepté l'historique.
 */
export function counselorReadableSince(access: CounselorAccess | null): Date | "all" | null {
  if (!access || access.status !== "granted" || !access.grantedAt) return null;
  const history = access.coupleMembers.every((m) => access.historyConsents[m] === true);
  return history ? "all" : access.grantedAt;
}

export function counselorCanRead(access: CounselorAccess | null, messageAt: Date): boolean {
  const since = counselorReadableSince(access);
  if (since === null) return false;
  return since === "all" || messageAt.getTime() >= since.getTime();
}

/** Bannière permanente dans le chat tant que le conseiller y est. */
export function showCounselorBanner(access: CounselorAccess | null): boolean {
  return access?.status === "granted";
}
