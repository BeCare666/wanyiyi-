/** Membre connecté, tel que l'affichent l'en-tête et la barre mobile. */
export type SessionMember = {
  firstName: string;
  avatarUrl: string | null;
};

/**
 * Membre connecté, ou null pour un visiteur.
 * Phase 1 : aucune connexion n'existe encore, la fonction renvoie toujours null.
 * Phase 2 : lecture de la session Supabase (OTP) et de la photo principale du profil.
 */
export async function getSessionMember(): Promise<SessionMember | null> {
  return null;
}
