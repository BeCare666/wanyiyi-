/**
 * Accès du conseiller au chat du couple (section 9.6) :
 *   - demandé par l'un des deux membres (sa demande vaut accord), accepté par l'autre ;
 *   - le conseiller lit la conversation à partir de l'acceptation, l'historique seulement si
 *     les deux l'ont coché ;
 *   - chacun peut retirer l'accès à tout moment, effet immédiat ;
 *   - le canal privé individuel ne montre que ce que le membre écrit au conseiller.
 */

export type AccessStatus = "requested" | "granted" | "refused" | "revoked";

export type CounselorAccess = {
  coupleMembers: readonly [string, string];
  requestedBy: string;
  status: AccessStatus;
  grantedAt: Date | null;
  /** Choix de chacun sur l'historique (avant l'acceptation). */
  historyConsents: Readonly<Record<string, boolean>>;
};

export type AccessRefusal = "not_member" | "not_pending" | "own_request";

/** Demande d'accès : la personne qui demande donne déjà son accord. */
export function requestAccess(coupleMembers: readonly [string, string], memberId: string, includeHistory: boolean): CounselorAccess | AccessRefusal {
  if (!coupleMembers.includes(memberId)) return "not_member";
  return { coupleMembers, requestedBy: memberId, status: "requested", grantedAt: null, historyConsents: { [memberId]: includeHistory } };
}

/** Réponse de l'autre membre : acceptation (avec son choix sur l'historique) ou refus. */
export function answerAccess(access: CounselorAccess, memberId: string, accept: boolean, includeHistory: boolean, now: Date): CounselorAccess | AccessRefusal {
  if (!access.coupleMembers.includes(memberId)) return "not_member";
  if (access.status !== "requested") return "not_pending";
  if (memberId === access.requestedBy) return "own_request";
  if (!accept) return { ...access, status: "refused" };
  return { ...access, status: "granted", grantedAt: now, historyConsents: { ...access.historyConsents, [memberId]: includeHistory } };
}

/** Retrait par l'un ou l'autre, à tout moment, effet immédiat. */
export function revokeAccess(access: CounselorAccess, memberId: string): CounselorAccess | AccessRefusal {
  if (!access.coupleMembers.includes(memberId)) return "not_member";
  if (access.status !== "granted" && access.status !== "requested") return "not_pending";
  return { ...access, status: "revoked" };
}

/**
 * Messages du couple lisibles par le conseiller : aucun sans accès accordé ; depuis
 * l'acceptation, ou toute la conversation si les deux ont coché l'historique.
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

/** Bannière permanente dans le chat tant que le conseiller y a accès. */
export function showCounselorBanner(access: CounselorAccess | null): boolean {
  return access?.status === "granted";
}
