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
