"use client";

import { CaretRightIcon, ListIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { durations, easeSoft } from "@/lib/motion";
import type { SessionMember } from "@/lib/session";
import { LanguageList } from "./LanguageSwitcher";
import { MemberAvatar } from "./MemberAvatar";
import { drawerItems, isNavActive, memberSpaceHref, mobileTabs } from "./navItems";
import { SocialLinks } from "./SocialLinks";

type Props = { member: SessionMember | null; pathname: string; activeSection: string | null };

/**
 * Navigation mobile (moins de 1024 px) : barre fixe en bas de l'écran, quatre rubriques
 * et le bouton Menu, qui ouvre un tiroir avec toute la navigation, la langue et les réseaux.
 */
export function MobileNav({ member, pathname, activeSection }: Props) {
  const t = useTranslations();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  // Tiroir ouvert : défilement verrouillé, touche Échap, focus gardé dans le tiroir
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key !== "Tab" || !sheetRef.current) return;
      const focusables = sheetRef.current.querySelectorAll<HTMLElement>("a[href], button");
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Passage en largeur ordinateur (rotation, fenêtre agrandie) : le tiroir se ferme
  useEffect(() => {
    if (!open) return;
    const query = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [open]);

  const transition = { duration: reduce ? 0 : durations.base, ease: easeSoft };

  return (
    <>
      <nav
        aria-label={t("Common.menu")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <ul className="mx-auto grid h-16 max-w-xl grid-cols-5">
          {mobileTabs.map((item) => {
            const active = isNavActive(item, pathname, activeSection, mobileTabs);
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-full flex-col items-center justify-center gap-1 text-fg transition-opacity duration-300",
                    active ? "opacity-100" : "opacity-60",
                  )}
                >
                  <TabIndicator active={active} />
                  <item.Icon size={22} weight="light" aria-hidden="true" />
                  <span className="max-w-full truncate px-1 text-[0.6875rem] leading-none">{t(`Nav.${item.key}`)}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              ref={menuButtonRef}
              type="button"
              aria-expanded={open}
              aria-controls="menu-mobile"
              aria-label={t("Common.openMenu")}
              onClick={() => setOpen(true)}
              className="relative flex h-full w-full flex-col items-center justify-center gap-1 text-fg"
            >
              <TabIndicator active={open} />
              <ListIcon size={22} weight="light" aria-hidden="true" />
              <span className="text-[0.6875rem] leading-none">{t("Common.menu")}</span>
            </button>
          </li>
        </ul>
      </nav>

      <AnimatePresence>
        {open && (
          <div className="lg:hidden">
            <motion.div
              key="overlay"
              aria-hidden="true"
              className="fixed inset-0 z-50 bg-ink/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
              onClick={close}
            />
            <motion.div
              key="sheet"
              id="menu-mobile"
              ref={sheetRef}
              role="dialog"
              aria-modal="true"
              aria-label={t("Common.menu")}
              className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92svh] flex-col rounded-t-[4px] bg-bg pb-[env(safe-area-inset-bottom)]"
              initial={{ y: reduce ? 0 : "100%", opacity: reduce ? 0 : 1 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: reduce ? 0 : "100%", opacity: reduce ? 0 : 1 }}
              transition={transition}
            >
              <div className="flex items-center justify-between border-b border-line px-gutter py-3">
                <Logo />
                <button
                  type="button"
                  className="inline-flex size-11 items-center justify-center rounded-sm border border-line text-fg"
                  aria-label={t("Common.closeMenu")}
                  onClick={close}
                >
                  <XIcon size={20} weight="light" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain px-gutter">
                {member && (
                  <Link
                    href={memberSpaceHref}
                    onClick={() => setOpen(false)}
                    className="mt-5 flex items-center gap-4 rounded-sm border border-line p-4"
                  >
                    <MemberAvatar member={member} size={44} />
                    <span className="flex-1">
                      <span className="block font-serif text-xl">{member.firstName}</span>
                      <span className="eyebrow">{t("Nav.account")}</span>
                    </span>
                    <CaretRightIcon size={16} weight="light" aria-hidden="true" className="text-fg-muted" />
                  </Link>
                )}

                <ul className="py-2">
                  {drawerItems.map((item) => {
                    const active = isNavActive(item, pathname, activeSection, drawerItems);
                    return (
                      <li key={item.key} className="border-b border-line last:border-b-0">
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className="flex min-h-16 items-center gap-4 py-3"
                        >
                          <span
                            className={cn(
                              "flex size-11 shrink-0 items-center justify-center rounded-sm border",
                              active ? "border-fg bg-fg text-bg" : "border-line text-fg",
                            )}
                          >
                            <item.Icon size={20} weight="light" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-serif text-xl leading-snug">{t(`Nav.${item.key}`)}</span>
                            {item.key !== "home" && (
                              <span className="mt-0.5 block text-xs leading-snug text-fg-muted">{t(`Nav.hints.${item.key}`)}</span>
                            )}
                          </span>
                          <CaretRightIcon size={14} weight="light" aria-hidden="true" className="shrink-0 text-fg-muted" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>

                <div className="border-t border-line py-6">
                  <p className="eyebrow">{t("Language.label")}</p>
                  <LanguageList className="mt-4" onSelect={() => setOpen(false)} />
                </div>

                {!member && (
                  <ButtonLink href="/inscription" className="mb-6 w-full" onClick={() => setOpen(false)}>
                    {t("Common.becomeMember")}
                  </ButtonLink>
                )}
              </div>

              <div className="surface-inverse flex flex-wrap items-center justify-between gap-x-4 gap-y-3 bg-bg-inverse px-gutter py-4 text-fg-inverse">
                <p className="eyebrow text-fg-inverse-muted">{t("Social.title")}</p>
                <SocialLinks size="sm" />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Filet au-dessus de l'entrée active (transform uniquement). */
function TabIndicator({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute inset-x-0 top-0 mx-auto h-px w-7 origin-center bg-accent transition-transform duration-500 ease-soft",
        active ? "scale-x-100" : "scale-x-0",
      )}
    />
  );
}
