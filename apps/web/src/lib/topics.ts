/**
 * Sujets de débat des soirées (demande du 06/11/2026) : quatre par soirée, les mêmes sur toutes
 * les tables. Même liste, dans le même ordre, que la table app.debate_topics (migration
 * 20261106000000) ; les textes sont dans messages/*.json, section « Topics ».
 */
export const DEBATE_TOPICS = [
  "lasting_love",
  "family_place",
  "money_together",
  "faith_couple",
  "house_chores",
  "children_education",
  "in_laws",
  "trust_social_media",
  "career_couple",
  "ideal_first_date",
  "respect",
  "tradition_modernity",
  "disagreements",
  "shared_hobbies",
  "where_to_live",
  "friends_other_sex",
  "small_attentions",
  "saving_projects",
  "roles_home",
  "lessons_past",
  "forgiveness",
  "phone_time",
  "travel_dreams",
  "friends_place",
] as const;

export type DebateTopic = (typeof DEBATE_TOPICS)[number];

const known = new Set<string>(DEBATE_TOPICS);

export function isDebateTopic(value: unknown): value is DebateTopic {
  return typeof value === "string" && known.has(value);
}

/** Quatre sujets différents de la liste. */
export function isTopicSet(value: unknown): value is DebateTopic[] {
  return Array.isArray(value) && value.length === 4 && value.every(isDebateTopic) && new Set(value).size === 4;
}

/** Sujets lus dans la base : seulement ceux de la liste (une valeur inconnue n'est pas affichée). */
export function readTopics(value: unknown): DebateTopic[] {
  return Array.isArray(value) ? value.filter(isDebateTopic) : [];
}
