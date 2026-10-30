/**
 * Page où revenir après la connexion (paramètre « suite »).
 * Seule une adresse interne au site est acceptée : jamais de redirection vers un autre domaine.
 */
export function safeNextPath(value: string | string[] | undefined | null, fallback = "/espace"): string {
  const path = Array.isArray(value) ? value[0] : value;
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return fallback;
  return path;
}

/** Adresse de la page de connexion, avec la page à rouvrir ensuite. */
export function signInHref(next: string): string {
  return `/connexion?suite=${encodeURIComponent(next)}`;
}

/** Rôles de l'équipe qui travaillent dans l'administration (même liste que lib/staff.ts). */
const ADMIN_ROLES = ["moderator", "admin", "super_admin"];

/**
 * Page ouverte après la connexion. Équipe (modération, administration, super administration) :
 * toujours l'administration, quelle que soit l'adresse demandée ; une page de l'administration
 * demandée est gardée. Autres rôles : la page demandée.
 */
export function pathAfterSignIn(next: string, role: unknown): string {
  if (typeof role !== "string" || !ADMIN_ROLES.includes(role)) return next;
  return next === "/admin" || next.startsWith("/admin/") || next.startsWith("/admin?") ? next : "/admin";
}
