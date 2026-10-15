"use client";

import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useId, useRef, useState } from "react";
import { Flag } from "@/components/brand/Flag";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/cn";
import { durations, easeSoft } from "@/lib/motion";
import { useDismiss } from "@/lib/useDismiss";

type Tone = "default" | "inverse";

/**
 * Sélecteur de langue en menu déroulant : drapeau, code, puis la liste des langues
 * avec leur nom dans leur propre langue. Le choix est mémorisé par cookie (next-intl).
 * `direction="up"` ouvre la liste vers le haut (bas de page).
 */
export function LanguageMenu({
  className,
  tone = "default",
  direction = "down",
  align = "end",
}: {
  className?: string;
  tone?: Tone;
  direction?: "down" | "up";
  align?: "start" | "end";
}) {
  const t = useTranslations("Language");
  const locale = useLocale();
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const close = useCallback((fromKeyboard: boolean) => {
    setOpen(false);
    if (fromKeyboard) buttonRef.current?.focus();
  }, []);
  useDismiss(rootRef, open, close);

  const offset = direction === "down" ? -6 : 6;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${t("label")} : ${t(locale)}`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          // Mobile : drapeau seul dans un carré à filet ; à partir de 640 px : drapeau, code et flèche
          "inline-flex size-10 items-center justify-center gap-2 rounded-sm border border-current/20 text-xs font-medium uppercase tracking-[0.14em] sm:size-auto sm:min-h-11 sm:border-0 sm:px-2",
          tone === "inverse" ? "text-fg-inverse" : "text-fg",
        )}
      >
        <Flag locale={locale} />
        <span className="hidden sm:inline">{locale}</span>
        <CaretDownIcon
          size={12}
          weight="light"
          aria-hidden="true"
          className={cn("hidden transition-transform duration-300 ease-soft sm:block", open !== (direction === "up") && "rotate-180")}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            id={listId}
            initial={{ opacity: 0, y: reduce ? 0 : offset }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : offset }}
            transition={{ duration: reduce ? 0 : durations.fast, ease: easeSoft }}
            className={cn(
              "absolute z-50 w-56 border border-line-strong/40 bg-bg-elevated py-2 text-fg shadow-[0_28px_60px_-28px_rgb(14_13_16/0.35)]",
              direction === "down" ? "top-full mt-2" : "bottom-full mb-2",
              align === "end" ? "right-0" : "left-0",
              // Mobile, en haut de page : liste calée sur les marges de l'écran, jamais hors champ
              direction === "down" && "max-sm:fixed max-sm:inset-x-gutter max-sm:top-16 max-sm:mt-0 max-sm:w-auto",
            )}
          >
            {routing.locales.map((l) => {
              const current = l === locale;
              return (
                <li key={l}>
                  <Link
                    href={pathname}
                    locale={l}
                    lang={l}
                    hrefLang={l}
                    aria-current={current ? "true" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-12 items-center gap-4 px-5 text-sm",
                      current ? "text-fg" : "text-fg-muted hover:bg-bg-soft hover:text-fg",
                    )}
                  >
                    <Flag locale={l} className="w-6" />
                    <span className="flex-1">{t(l)}</span>
                    <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-fg-muted">{l}</span>
                    <CheckIcon
                      size={14}
                      weight="light"
                      aria-hidden="true"
                      className={cn("text-fg", !current && "invisible")}
                    />
                  </Link>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Liste des langues en clair (tiroir mobile) : trois choix visibles, sans menu. */
export function LanguageList({ className, onSelect }: { className?: string; onSelect?: () => void }) {
  const t = useTranslations("Language");
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t("label")} className={className}>
      <ul className="grid grid-cols-3 gap-2">
        {routing.locales.map((l) => {
          const current = l === locale;
          return (
            <li key={l}>
              <Link
                href={pathname}
                locale={l}
                lang={l}
                hrefLang={l}
                aria-current={current ? "true" : undefined}
                onClick={onSelect}
                className={cn(
                  "flex min-h-12 items-center justify-center gap-2.5 rounded-sm border px-2 text-sm",
                  current ? "border-fg text-fg" : "border-line text-fg-muted",
                )}
              >
                <Flag locale={l} />
                {t(l)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
