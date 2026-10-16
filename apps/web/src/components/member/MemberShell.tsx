"use client";

import { CaretDoubleLeftIcon, GearSixIcon, ListIcon, SignOutIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Logo } from "@/components/brand/Logo";
import { LanguageList } from "@/components/layout/LanguageSwitcher";
import { MemberAvatar } from "@/components/layout/MemberAvatar";
import { Link, usePathname } from "@/i18n/navigation";
import { signOut } from "@/lib/auth-actions";
import { cn } from "@/lib/cn";
import { durations, easeSoft } from "@/lib/motion";
import type { SessionMember, SessionNotification } from "@/lib/session";
import { isMemberNavActive, memberHome, memberNav, type MemberNavItem, memberPrimary, memberSecondary } from "./memberNav";
import { NotificationBell } from "./NotificationBell";

type Props = {
  member: SessionMember;
  notifications: { items: SessionNotification[]; unread: number };
  children: ReactNode;
};

const COLLAPSED_KEY = "wanyiyi.sidebar.collapsed";

/**
 * Barre latérale repliée : préférence mémorisée dans ce navigateur seulement (simple confort
 * d'affichage). Lue comme une source externe : dépliée au rendu serveur, puis valeur enregistrée.
 */
const collapsedListeners = new Set<() => void>();
const collapsedStore = {
  subscribe(listener: () => void) {
    collapsedListeners.add(listener);
    return () => collapsedListeners.delete(listener);
  },
  get(): boolean {
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  },
  set(value: boolean) {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
    } catch {}
    collapsedListeners.forEach((listener) => listener());
  },
};

/**
 * Coquille de l'espace membre (section 6.1).
 * Ordinateur : barre latérale fixe à gauche, repliable en icônes seules.
 * Mobile : en-tête avec bouton menu (tiroir latéral) et barre basse des 4 sections principales.
 * En-tête : cloche des notifications, accès aux paramètres, avatar monogramme.
 */
export function MemberShell({ member, notifications, children }: Props) {
  const t = useTranslations("Member");
  const tc = useTranslations("Common");
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(collapsedStore.subscribe, collapsedStore.get, () => false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const toggleCollapsed = () => collapsedStore.set(!collapsed);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  return (
    <>
      <Sidebar member={member} pathname={pathname} collapsed={collapsed} onToggle={toggleCollapsed} />

      <div className={cn("flex min-h-svh flex-col", collapsed ? "lg:pl-[4.75rem]" : "lg:pl-64")}>
        <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur-md">
          <div className="flex h-16 items-center justify-between gap-3 px-gutter">
            <div className="flex items-center gap-2 lg:hidden">
              <button
                ref={menuButtonRef}
                type="button"
                aria-expanded={drawerOpen}
                aria-controls="tiroir-membre"
                aria-label={tc("openMenu")}
                onClick={() => setDrawerOpen(true)}
                className="-ml-2 inline-flex size-11 items-center justify-center rounded-sm text-fg"
              >
                <ListIcon size={22} weight="light" aria-hidden="true" />
              </button>
              <Link href={memberHome} aria-label={t("nav.dashboard")} className="inline-flex text-fg">
                <Logo />
              </Link>
            </div>
            <p className="eyebrow hidden lg:block">{t("areaLabel")}</p>

            <div className="flex items-center gap-1 sm:gap-2">
              <NotificationBell items={notifications.items} unread={notifications.unread} />
              <Link
                href={memberNav.settings.href}
                aria-label={t("nav.settings")}
                className="hidden size-11 items-center justify-center rounded-sm text-fg sm:inline-flex"
              >
                <GearSixIcon size={22} weight="light" aria-hidden="true" />
              </Link>
              <Link href={memberNav.profile.href} aria-label={t("nav.profile")} className="ml-1 inline-flex rounded-full">
                <MemberAvatar member={member} size={36} tone={member.darkMode ? "night" : "rose"} />
              </Link>
            </div>
          </div>
        </header>

        <main id="contenu" className="flex-1 px-gutter pb-28 pt-10 lg:pb-16 lg:pt-14">
          {children}
        </main>
      </div>

      <BottomBar pathname={pathname} />
      <Drawer member={member} pathname={pathname} open={drawerOpen} onClose={closeDrawer} onNavigate={() => setDrawerOpen(false)} />
    </>
  );
}

/** Lien de navigation : icône au trait fin, filet à gauche sur l'entrée active. */
function NavLink({
  item,
  active,
  collapsed = false,
  onNavigate,
}: {
  item: MemberNavItem;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("Member.nav");
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? t(item.key) : undefined}
      className={cn(
        "relative flex min-h-12 items-center gap-4 rounded-sm px-3 transition-opacity duration-300",
        active ? "opacity-100" : "opacity-70 hover:opacity-100",
        collapsed && "justify-center px-0",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-2 left-0 w-px origin-center bg-accent transition-transform duration-500 ease-soft",
          active ? "scale-y-100" : "scale-y-0",
        )}
      />
      <item.Icon size={22} weight={active ? "regular" : "light"} aria-hidden="true" className="shrink-0" />
      <span className={cn("truncate text-sm", collapsed && "sr-only")}>{t(item.key)}</span>
    </Link>
  );
}

function SignOutButton({ collapsed = false }: { collapsed?: boolean }) {
  const t = useTranslations("Member");
  return (
    <form action={signOut}>
      <button
        type="submit"
        title={collapsed ? t("signOut") : undefined}
        className={cn(
          "flex min-h-12 w-full items-center gap-4 rounded-sm px-3 text-sm opacity-70 transition-opacity duration-300 hover:opacity-100",
          collapsed && "justify-center px-0",
        )}
      >
        <SignOutIcon size={22} weight="light" aria-hidden="true" className="shrink-0" />
        <span className={cn(collapsed && "sr-only")}>{t("signOut")}</span>
      </button>
    </form>
  );
}

/** Barre latérale (1024 px et plus). Repliée : icônes seules, libellés lus par les lecteurs d'écran. */
function Sidebar({
  member,
  pathname,
  collapsed,
  onToggle,
}: {
  member: SessionMember;
  pathname: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("Member");
  return (
    <aside
      aria-label={t("areaLabel")}
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-bg lg:flex",
        collapsed ? "w-[4.75rem] px-3" : "w-64 px-5",
      )}
    >
      <div className={cn("flex h-16 items-center border-b border-line", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed && (
          <Link href={memberHome} aria-label={t("nav.dashboard")} className="inline-flex text-fg">
            <Logo />
          </Link>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? t("expand") : t("collapse")}
          aria-expanded={!collapsed}
          className="inline-flex size-10 items-center justify-center rounded-sm text-fg-muted hover:text-fg"
        >
          <CaretDoubleLeftIcon
            size={18}
            weight="light"
            aria-hidden="true"
            className={cn("transition-transform duration-500 ease-soft", collapsed && "rotate-180")}
          />
        </button>
      </div>

      <nav aria-label={t("areaLabel")} className="flex flex-1 flex-col justify-between overflow-y-auto py-6">
        <ul className="space-y-1">
          {memberPrimary.map((item) => (
            <li key={item.key}>
              <NavLink item={item} active={isMemberNavActive(item, pathname)} collapsed={collapsed} />
            </li>
          ))}
        </ul>
        <ul className="mt-8 space-y-1 border-t border-line pt-6">
          {memberSecondary.map((item) => (
            <li key={item.key}>
              <NavLink item={item} active={isMemberNavActive(item, pathname)} collapsed={collapsed} />
            </li>
          ))}
          <li>
            <SignOutButton collapsed={collapsed} />
          </li>
        </ul>
      </nav>

      <div className={cn("flex items-center gap-3 border-t border-line py-4", collapsed && "justify-center")}>
        <MemberAvatar member={member} size={36} tone={member.darkMode ? "night" : "rose"} />
        {!collapsed && <span className="truncate font-serif text-lg">{member.firstName ?? t("account")}</span>}
      </div>
    </aside>
  );
}

/** Barre basse (mobile) : les 4 sections principales. */
function BottomBar({ pathname }: { pathname: string }) {
  const t = useTranslations("Member");
  return (
    <nav
      aria-label={t("areaLabel")}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-xl grid-cols-4">
        {memberPrimary.map((item) => {
          const active = isMemberNavActive(item, pathname);
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
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-0 top-0 mx-auto h-px w-7 origin-center bg-accent transition-transform duration-500 ease-soft",
                    active ? "scale-x-100" : "scale-x-0",
                  )}
                />
                <item.Icon size={22} weight="light" aria-hidden="true" />
                <span className="max-w-full truncate px-1 text-[0.6875rem] leading-none">{t(`nav.${item.key}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Tiroir latéral (mobile) : avatar et prénom en haut, toute la navigation,
 * langue et déconnexion en bas. Échap ferme, le focus reste dans le tiroir.
 */
function Drawer({
  member,
  pathname,
  open,
  onClose,
  onNavigate,
}: {
  member: SessionMember;
  pathname: string;
  open: boolean;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const t = useTranslations();
  const reduce = useReducedMotion();
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheetRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
  }, [open, onClose]);

  // Passage en largeur ordinateur : le tiroir se ferme
  useEffect(() => {
    if (!open) return;
    const query = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) onNavigate();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [open, onNavigate]);

  const transition = { duration: reduce ? 0 : durations.base, ease: easeSoft };

  return (
    <AnimatePresence>
      {open && (
        <div className="lg:hidden">
          <motion.div
            key="voile"
            aria-hidden="true"
            className="fixed inset-0 z-50 bg-ink/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
            onClick={onClose}
          />
          <motion.div
            key="tiroir"
            id="tiroir-membre"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("Member.areaLabel")}
            className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] flex-col border-r border-line bg-bg pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
            initial={{ x: reduce ? 0 : "-100%", opacity: reduce ? 0 : 1 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: reduce ? 0 : "-100%", opacity: reduce ? 0 : 1 }}
            transition={transition}
          >
            <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-5">
              <span className="flex min-w-0 items-center gap-4">
                <MemberAvatar member={member} size={44} tone={member.darkMode ? "night" : "rose"} />
                <span className="min-w-0">
                  <span className="block truncate font-serif text-xl">{member.firstName ?? t("Member.account")}</span>
                  <span className="eyebrow">{t("Member.areaLabel")}</span>
                </span>
              </span>
              <button
                type="button"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm border border-line text-fg"
                aria-label={t("Common.closeMenu")}
                onClick={onClose}
              >
                <XIcon size={20} weight="light" />
              </button>
            </div>

            <nav aria-label={t("Member.areaLabel")} className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
              <ul className="space-y-1">
                {[...memberPrimary, ...memberSecondary].map((item) => (
                  <li key={item.key}>
                    <NavLink item={item} active={isMemberNavActive(item, pathname)} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </nav>

            <div className="border-t border-line px-5 py-5">
              <p className="eyebrow">{t("Language.label")}</p>
              <LanguageList className="mt-4" onSelect={onNavigate} />
            </div>
            <div className="border-t border-line px-2 py-2">
              <SignOutButton />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
