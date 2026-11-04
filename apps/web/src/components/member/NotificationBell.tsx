"use client";

import { BellIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useId, useRef, useState } from "react";
import { markNotificationsRead } from "@/app/[locale]/(membre)/espace/notifications/actions";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { durations, easeSoft } from "@/lib/motion";
import type { SessionNotification } from "@/lib/session";
import { useDismiss } from "@/lib/useDismiss";
import { memberNav } from "./memberNav";
import { notificationHref, notificationKey } from "./notificationKinds";

/** Cloche de l'en-tête (section 6.1) : compteur des non lues et panneau des dernières notifications. */
export function NotificationBell({ items, unread }: { items: SessionNotification[]; unread: number }) {
  const t = useTranslations("Member.bell");
  const format = useFormatter();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((fromKeyboard: boolean) => {
    setOpen(false);
    if (fromKeyboard) buttonRef.current?.focus();
  }, []);
  useDismiss(rootRef, open, close);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${t("label")}. ${t("unread", { count: unread })}`}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex size-11 items-center justify-center rounded-sm text-fg"
      >
        <BellIcon size={22} weight={open ? "regular" : "light"} aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 inline-flex min-w-5 items-center justify-center rounded-sm bg-accent px-1 text-[0.6875rem] font-medium leading-5 text-accent-fg"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            // Téléphone (03/11/2026) : panneau sur toute la largeur sous l'en-tête, au lieu d'être accroché
            // à la cloche (l'avatar à sa droite le faisait déborder de l'écran) ; défilement interne
            className="fixed inset-x-4 top-[4.5rem] z-50 flex max-h-[calc(100svh-10rem)] flex-col border border-line bg-bg-elevated sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[min(36rem,calc(100svh-6rem))] sm:w-[22rem]"
            initial={{ opacity: 0, y: reduce ? 0 : -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -6 }}
            transition={{ duration: reduce ? 0 : durations.fast, ease: easeSoft }}
          >
            <p className="eyebrow shrink-0 border-b border-line px-5 py-4">{t("unread", { count: unread })}</p>
            {items.length === 0 ? (
              <p className="px-5 py-6 text-sm text-fg-muted">{t("empty")}</p>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {items.map((n) => {
                  const href = notificationHref(n.kind);
                  const body = (
                    <>
                      <p className={cn("text-sm", n.read ? "text-fg-muted" : "text-fg")}>
                        {!n.read && <span aria-hidden="true" className="mr-2 inline-block size-1.5 translate-y-[-2px] bg-accent" />}
                        {t(`kinds.${notificationKey(n.kind)}`)}
                      </p>
                      {n.message && <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{n.message}</p>}
                      <p className="mt-1 text-xs text-fg-muted">
                        {format.dateTime(new Date(n.createdAt), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </>
                  );
                  return (
                    <li key={n.id} className="border-b border-line last:border-b-0">
                      {/* Chaque notification mène à l'étape concernée (03/11/2026) */}
                      {href ? (
                        <Link
                          href={href}
                          onClick={() => {
                            if (!n.read) void markNotificationsRead([n.id]);
                            setOpen(false);
                          }}
                          className="block px-5 py-4 hover:bg-bg"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="px-5 py-4">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <Link
              href={memberNav.notifications.href}
              onClick={() => setOpen(false)}
              className="block shrink-0 border-t border-line px-5 py-4 text-sm text-link underline-offset-4 hover:underline"
            >
              {t("seeAll")}
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
