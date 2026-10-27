/** Messages système du chat du couple (question 9) : code envoyé par la base, texte traduit ici. */
const systemCodes = [
  "counselor_access.requested",
  "counselor_access.accepted",
  "counselor_access.payment_due",
  "counselor_access.awaiting_assignment",
  "counselor_access.refused",
  "counselor_access.revoked",
  "counselor_access.granted",
  "couple.blocked",
  "couple.unblocked",
  // Vie et fins du couple (questions 6 et 7)
  "couple.paused",
  "couple.resumed",
  "couple.resume_requested",
  "couple.union_requested",
  "couple.union_celebrated",
  "couple.separation_requested",
  // Parcours du couple (question 16) : « code:étape »
  "milestone.reach_requested",
  "milestone.remove_requested",
  "milestone.reached",
  "milestone.removed",
  "milestone.date_changed",
  // Séances avec le conseiller (question 9)
  "session.proposed",
  "session.confirmed",
  "session.cancelled",
] as const;

const milestoneKinds = ["first_dates", "counselor_sessions", "family_introduction", "dowry_or_wedding", "celebration"] as const;

/** Message système « code » ou « code:étape » : clé de traduction et étape éventuelle. */
export function systemMessage(body: string): { key: string; step: (typeof milestoneKinds)[number] | null } | null {
  const [code = "", arg] = body.split(":");
  if (!(systemCodes as readonly string[]).includes(code)) return null;
  const step = milestoneKinds.find((k) => k === arg) ?? null;
  if (code.startsWith("milestone.") && !step) return null;
  return { key: code.replace(".", "_"), step };
}

export function systemKey(code: string): string | null {
  return systemMessage(code)?.key ?? null;
}
