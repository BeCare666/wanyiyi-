import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

export type SpaceTab = { key: string; label: string; count?: number };

export const TAB_PARAM = "onglet";

/** Onglet demandé dans l'adresse (?onglet=…), ou le premier si absent ou inconnu. */
export function currentTab<K extends string>(raw: string | string[] | undefined, keys: readonly K[]): K {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return keys.find((k) => k === value) ?? keys[0]!;
}

/**
 * Onglets d'un espace de discussion (audit UX du 3 novembre 2026) : une tâche par écran au lieu
 * d'une longue page. Liens simples (aucun JavaScript), collés sous l'en-tête et défilant
 * horizontalement sur téléphone.
 */
export function SpaceTabs({ tabs, current, pathname, label }: { tabs: SpaceTab[]; current: string; pathname: string; label: string }) {
  return (
    <nav aria-label={label} className="sticky top-16 z-20 -mx-gutter mt-8 border-b border-line bg-bg/95 px-gutter backdrop-blur-md lg:mx-0 lg:px-0">
      <ul className="-mb-px flex gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <li key={tab.key} className="shrink-0">
              <Link
                href={{ pathname, query: { [TAB_PARAM]: tab.key } }}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-12 items-center gap-2 border-b-2 text-sm",
                  active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {tab.label}
                {tab.count ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-sm bg-accent px-1 text-[0.6875rem] font-medium leading-5 text-accent-fg">
                    {tab.count > 99 ? "99+" : tab.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
