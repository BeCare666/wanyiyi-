"use client";

import { BellIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useId, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { durations, easeSoft } from "@/lib/motion";
import type { SessionNotification } from "@/lib/session";
import { useDismiss } from "@/lib/useDismiss";
import { memberNav } from "./memberNav";

/** Clé de traduction d'un type de notification (les points du type deviennent des tirets bas). */
const knownKinds = new Set(["evening_seat_offered", "match_announced"]);
function kindKey(kind: string) {
  const key = kind.replace(/\./g, "_");
  return knownKinds.has(key) ? key : "other";
}

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
            className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] border border-line bg-bg-elevated"
            initial={{ opacity: 0, y: reduce ? 0 : -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -6 }}
            transition={{ duration: reduce ? 0 : durations.fast, ease: easeSoft }}
          >
            <p className="eyebrow border-b border-line px-5 py-4">{t("unread", { count: unread })}</p>
            {items.length === 0 ? (
              <p className="px-5 py-6 text-sm text-fg-muted">{t("empty")}</p>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id} className="border-b border-line px-5 py-4 last:border-b-0">
                    <p className={cn("text-sm", n.read ? "text-fg-muted" : "text-fg")}>
                      {!n.read && <span aria-hidden="true" className="mr-2 inline-block size-1.5 translate-y-[-2px] bg-accent" />}
                      {t(`kinds.${kindKey(n.kind)}`)}
                    </p>
                    <p className="mt-1 text-xs text-fg-muted">
                      {format.dateTime(new Date(n.createdAt), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={memberNav.notifications.href}
              onClick={() => setOpen(false)}
              className="block border-t border-line px-5 py-4 text-sm text-link underline-offset-4 hover:underline"
            >
              {t("seeAll")}
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
