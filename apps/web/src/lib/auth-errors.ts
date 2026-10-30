/**
 * Erreurs de Supabase Auth (codes documentés) vers les clés des messages affichés,
 * pour l'inscription, la connexion et le mot de passe oublié.
 */
export type AuthErrorKey =
  | "invalidCredentials"
  | "notConfirmed"
  | "tooManyRequests"
  | "weak_password"
  | "invalid_email"
  | "same_password"
  | "email_exists"
  | "generic";

/** Code renvoyé par Supabase Auth, affiché sous un message général pour trouver la cause. */
export function authErrorCode(error: { code?: string; status?: number }): string {
  return error.code || (error.status ? String(error.status) : "inconnu");
}

export function authErrorKey(error: { code?: string; status?: number }): AuthErrorKey {
  const code = error.code ?? "";
  if (error.status === 429 || code.startsWith("over_")) return "tooManyRequests";
  if (code === "invalid_credentials") return "invalidCredentials";
  if (code === "email_not_confirmed") return "notConfirmed";
  if (code === "weak_password") return "weak_password";
  if (code === "email_address_invalid") return "invalid_email";
  if (code === "same_password") return "same_password";
  // Seulement si la confirmation par e-mail est désactivée dans Supabase ; sinon aucune erreur n'est renvoyée
  if (code === "email_exists" || code === "user_already_exists") return "email_exists";
  return "generic";
}
