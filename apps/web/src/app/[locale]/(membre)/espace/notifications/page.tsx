import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { memberNav } from "@/components/member/memberNav";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { getRecentNotifications } from "@/lib/session";
import { NotificationList } from "./NotificationList";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.notifications");
  return { title: t("title") };
}

/** Nombre de notifications affichées (les plus récentes). */
const PAGE_SIZE = 50;

type Props = { searchParams: Promise<{ filtre?: string | string[] }> };

/** Filtres (section 6.2-8) : toutes, ou non lues seulement (?filtre=non-lues). */
const filters = [
  { key: "all", query: undefined },
  { key: "unread", query: "non-lues" },
] as const;

/**
 * Notifications du membre (section 6.2-8) : liste complète, filtres, marquer comme lu.
 * Les plus récentes d'abord.
 */
export default async function NotificationsPage({ searchParams }: Props) {
  const t = await getTranslations("Member");
  const raw = (await searchParams).filtre;
  const unreadOnly = (Array.isArray(raw) ? raw[0] : raw) === "non-lues";
  const { items } = await getRecentNotifications(PAGE_SIZE, { unreadOnly });

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("nav.notifications")}
        </p>
        <h1 className="mt-6 text-4xl">{t("notifications.title")}</h1>
      </header>

      <nav aria-label={t("notifications.filters.label")} className="mt-12 flex flex-wrap gap-2">
        {filters.map(({ key, query }) => {
          const active = (key === "unread") === unreadOnly;
          return (
            <Link
              key={key}
              href={query ? { pathname: memberNav.notifications.href, query: { filtre: query } } : memberNav.notifications.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 items-center rounded-sm border px-4 text-sm",
                active ? "border-fg bg-fg text-bg" : "border-line text-fg hover:border-fg",
              )}
            >
              {t(`notifications.filters.${key}`)}
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <p className="mt-14 border-t border-line pt-8 text-fg-muted">{t(unreadOnly ? "notifications.noUnread" : "bell.empty")}</p>
      ) : (
        <NotificationList items={items} />
      )}
    </div>
  );
}
