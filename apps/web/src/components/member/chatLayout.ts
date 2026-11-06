/**
 * Mise en page de la discussion façon WhatsApp (06/11/2026) : jours, groupes de messages, accusé
 * de lecture. Fonctions pures, testées sans navigateur.
 */

type Message = { id: string; sender_id: string | null; created_at: string; is_system?: boolean };

/** Jour (AAAA-MM-JJ) d'une date, dans le fuseau donné (Cotonou par défaut). */
export function chatDayKey(iso: string, timeZone = "Africa/Porto-Novo"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * Chaque message avec : newDay (premier message d'un jour : séparateur au-dessus) et firstOfGroup
 * (premier d'une suite du même auteur le même jour : un peu d'espace et la pointe de la bulle).
 */
export function groupChat<M extends Message>(messages: readonly M[], timeZone = "Africa/Porto-Novo") {
  return messages.map((message, i) => {
    const previous = messages[i - 1];
    const newDay = !previous || chatDayKey(previous.created_at, timeZone) !== chatDayKey(message.created_at, timeZone);
    const firstOfGroup = newDay || !previous || Boolean(previous.is_system) || previous.sender_id !== message.sender_id;
    return { message, newDay, firstOfGroup };
  });
}

/**
 * Mon message est lu par l'autre (✓✓) s'il l'a ouvert après l'envoi, ou s'il a écrit depuis
 * (il a forcément vu la conversation).
 */
export function isReadByPartner(message: Message, messages: readonly Message[], memberId: string, partnerReadAt: string | null): boolean {
  const sent = new Date(message.created_at).getTime();
  if (partnerReadAt && new Date(partnerReadAt).getTime() >= sent) return true;
  return messages.some((m) => !m.is_system && m.sender_id !== null && m.sender_id !== memberId && new Date(m.created_at).getTime() > sent);
}
