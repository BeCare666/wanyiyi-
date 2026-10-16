/**
 * Projet Supabase du site : clé publique (anon) uniquement.
 * null tant que le projet n'est pas renseigné dans .env.local (question 1) :
 * personne ne peut alors se connecter et l'espace membre renvoie vers la connexion.
 */
export function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

/** Les tables de Wanyiyi sont dans le schéma « app » (à exposer dans les réglages de l'API Supabase). */
export const dbSchema = "app";
