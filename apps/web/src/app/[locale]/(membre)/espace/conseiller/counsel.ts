/** Conseiller sollicité seul (demande du 10 novembre 2026) : lignes et règles d'affichage. */

/** Ligne de app.my_counsel() : demande en cours du membre, et sa discussion une fois le conseiller attribué. */
export type CounselRow = {
  request_id: string;
  status: "requested" | "granted";
  created_at: string;
  granted_at: string | null;
  counselor_name: string | null;
  conversation_id: string | null;
  price_xof: number;
  free_left: number;
};

/**
 * Rappel affiché au-dessus de la discussion : messages gratuits restants, ou prix de chaque
 * message ; rien quand l'équipe a rendu les messages gratuits (prix 0).
 */
export function counselNotice(priceXof: number, freeLeft: number): "free" | "paid" | null {
  if (priceXof <= 0) return null;
  return freeLeft > 0 ? "free" : "paid";
}
