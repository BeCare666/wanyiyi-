"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { notificationHref, notificationKey } from "@/components/member/notificationKinds";
import { Button } from "@/components/ui/Button";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import type { SessionNotification } from "@/lib/session";
import { markNotificationsRead } from "./actions";

/**
 * Liste des notifications : une notification ouverte est marquée comme lue,
 * et un bouton marque toutes les autres. Le compteur de la cloche suit après rechargement.
 */
export function NotificationList({ items }: { items: SessionNotification[] }) {
  const t = useTranslations("Member");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const unread = items.some((n) => !n.read);

  function markAll() {
    setFailed(false);
    startTransition(async () => {
      if (!(await markNotificationsRead())) return setFailed(true);
      router.refresh();
    });
  }

  return (
    <>
      {unread && (
        <Button type="button" variant="secondary" disabled={pending} onClick={markAll} className="mt-10">
          {t("notifications.markAll")}
        </Button>
      )}
      {failed && (
        <p role="alert" className="mt-6 border-l border-accent pl-5 text-fg-muted">
          {t("errors.generic")}
        </p>
      )}
      <ol className="mt-10 border-t border-line">
        {items.map((n) => {
          const href = notificationHref(n.kind);
          const text = t(`bell.kinds.${notificationKey(n.kind)}`);
          return (
            <li key={n.id} className="grid gap-2 border-b border-line py-6 md:grid-cols-12 md:items-baseline md:gap-8">
              <p className={cn("md:col-span-8", n.read ? "text-fg-muted" : "text-fg")}>
                {!n.read && (
                  <>
                    <span aria-hidden="true" className="mr-3 inline-block size-1.5 translate-y-[-2px] bg-accent" />
                    <span className="sr-only">{t("notifications.unread")} : </span>
                  </>
                )}
                {href ? (
                  <Link
                    href={href}
                    onClick={() => {
                      if (!n.read) void markNotificationsRead([n.id]);
                    }}
                    className="underline-offset-4 hover:underline"
                  >
                    {text}
                  </Link>
                ) : (
                  text
                )}
                {n.reason && <span className="mt-2 block text-fg-muted">{t("notifications.reason", { reason: n.reason })}</span>}
              </p>
              <p className="text-sm text-fg-muted md:col-span-4 md:text-right">
                {format.dateTime(new Date(n.createdAt), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
              </p>
            </li>
          );
        })}
      </ol>
    </>
  );
}
