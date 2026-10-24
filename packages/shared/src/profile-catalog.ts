/**
 * Catalogue des questions du profil (section 8.2 de la note).
 * Les libellés sont dans les fichiers de traduction (clé Profile.<category>.<option>).
 *
 * visibility :
 * - "members"     visible par les membres
 * - "after_match" visible seulement après un match mutuel
 * - "team"        jamais visible par les membres (équipe uniquement)
 *
 * Jamais demandé : teint de peau, ethnie, adresse exacte, nom de l'employeur.
 */

export type Visibility = "members" | "after_match" | "team";

export type CatalogCategory = {
  key: string;
  options: readonly string[];
  /** Choix multiple pour « Je me décris » (les choix de « Ce que je recherche » sont toujours multiples). */
  multiple: boolean;
  optional: boolean;
  visibility: Visibility;
  min?: number;
  max?: number;
};

export const PROFILE_CATALOG = [
  { key: "marital_status", options: ["never_married", "divorced", "widowed"], multiple: false, optional: false, visibility: "members" },
  { key: "children", options: ["none", "yes_living_with_me", "yes_not_living_with_me"], multiple: false, optional: false, visibility: "members" },
  { key: "wants_children", options: ["yes", "no", "have_enough", "to_discuss"], multiple: false, optional: false, visibility: "members" },
  { key: "intention", options: ["civil", "religious", "traditional_dowry", "several"], multiple: false, optional: false, visibility: "members" },
  { key: "timeline", options: ["under_1_year", "1_to_2_years", "taking_my_time"], multiple: false, optional: false, visibility: "members" },
  { key: "religion", options: ["catholic", "protestant_evangelical", "muslim", "traditional", "other", "none"], multiple: false, optional: false, visibility: "members" },
  { key: "religious_practice", options: ["regular", "occasional", "little_or_none"], multiple: false, optional: false, visibility: "members" },
  { key: "education", options: ["primary", "secondary", "bac", "licence", "master_plus", "vocational"], multiple: false, optional: false, visibility: "members" },
  // Secteurs (question 4, choix du 24 octobre 2026, modifiable)
  {
    key: "sector",
    options: [
      "agriculture_agrifood", "trade", "education", "health", "public_administration", "banking_finance_insurance",
      "it_telecom", "construction_engineering", "transport_logistics", "hospitality_tourism", "crafts",
      "arts_media_communication", "law_justice", "ngo_international", "defence_security", "student", "other",
    ],
    multiple: false,
    optional: false,
    visibility: "members",
  },
  { key: "languages", options: ["french", "fon", "yoruba", "goun", "mina", "bariba", "dendi", "english", "other"], multiple: true, optional: false, visibility: "members" },
  // Tranches de 10 cm (question 4, choix du 24 octobre 2026)
  { key: "height", options: ["under_150", "150_159", "160_169", "170_179", "180_189", "190_plus"], multiple: false, optional: true, visibility: "members" },
  { key: "build", options: ["slim", "average", "athletic", "curvy"], multiple: false, optional: true, visibility: "members" },
  { key: "personality", options: ["calm", "joyful", "reserved", "sociable", "organised", "spontaneous", "patient", "ambitious", "funny", "attentive"], multiple: true, optional: false, visibility: "members", min: 3, max: 5 },
  { key: "tobacco", options: ["no", "sometimes", "yes"], multiple: false, optional: false, visibility: "members" },
  { key: "alcohol", options: ["never", "occasionally", "regularly"], multiple: false, optional: false, visibility: "members" },
  { key: "going_out", options: ["homebody", "balanced", "often_out"], multiple: false, optional: false, visibility: "members" },
  { key: "interests", options: ["cooking", "music", "reading", "sport", "travel", "entrepreneurship", "church_or_mosque", "associations", "cinema", "fashion"], multiple: true, optional: false, visibility: "members" },
  { key: "money_management", options: ["all_shared", "separate", "mixed"], multiple: false, optional: false, visibility: "after_match" },
  { key: "extended_family", options: ["very_important", "balanced", "couple_independence"], multiple: false, optional: false, visibility: "after_match" },
  { key: "desired_location", options: ["cotonou", "other_benin_city", "abroad", "indifferent"], multiple: false, optional: false, visibility: "after_match" },
  // Revenus mensuels en FCFA (question 4, choix du 24 octobre 2026 ; SMIG béninois : 52 000 FCFA)
  { key: "income", options: ["under_100k", "100k_250k", "250k_500k", "500k_1m", "1m_plus"], multiple: false, optional: true, visibility: "team" },
] as const satisfies readonly CatalogCategory[];

export type ProfileCategoryKey = (typeof PROFILE_CATALOG)[number]["key"];

/** Valeur spéciale de « Ce que je recherche ». */
export const INDIFFERENT = "indifferent";
