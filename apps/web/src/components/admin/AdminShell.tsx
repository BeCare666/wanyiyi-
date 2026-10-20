"use client";

import { CaretDoubleLeftIcon, ListIcon, SignOutIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Logo } from "@/components/brand/Logo";
import { LanguageList, LanguageMenu } from "@/components/layout/LanguageSwitcher";
import { MemberAvatar } from "@/components/layout/MemberAvatar";
import { Link, usePathname } from "@/i18n/navigation";
import { signOut } from "@/lib/auth-actions";
import { cn } from "@/lib/cn";
import { durations, easeSoft } from "@/lib/motion";
import type { StaffMember } from "@/lib/staff";
import { adminHome, type AdminNavGroup, type AdminNavItem, isAdminNavActive, visibleAdminNav } from "./adminNav";
import { GlobalSearch } from "./GlobalSearch";

const COLLAPSED_KEY = "wanyiyi.admin.sidebar.collapsed";

/** Barre repliée : préférence de ce navigateur seulement (même principe que l'espace membre). */
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
 * Coquille de l'administration (section 11.1).
 * Barre latérale fixe sur fond encre, groupes de menus, repliable en icônes seules ;
 * sur mobile, tiroir latéral. En-tête : recherche globale, langue et avatar de la personne connectée.
 */
export function AdminShell({ staff, children }: { staff: StaffMember; children: ReactNode }) {
  const t = useTranslations("Admin");
  const tc = useTranslations("Common");
  const pathname = usePathname();
  const groups = visibleAdminNav(staff.permissions);
  const collapsed = useSyncExternalStore(collapsedStore.subscribe, collapsedStore.get, () => false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  return (
    <>
      <aside
        data-theme="dark"
        aria-label={t("areaLabel")}
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-bg text-fg lg:flex print:hidden",
          collapsed ? "w-[4.75rem] px-3" : "w-64 px-5",
        )}
      >
        <div className={cn("flex h-16 items-center border-b border-line", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <Link href={adminHome} aria-label={t("home")} className="inline-flex text-fg">
              <Logo />
            </Link>
          )}
          <button
            type="button"
            onClick={() => collapsedStore.set(!collapsed)}
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
          <NavGroups groups={groups} pathname={pathname} collapsed={collapsed} />
          <div className="mt-8 border-t border-line pt-6">
            <SignOutButton collapsed={collapsed} />
          </div>
        </nav>
      </aside>

      <div className={cn("flex min-h-svh flex-col print:pl-0!", collapsed ? "lg:pl-[4.75rem]" : "lg:pl-64")}>
        <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur-md print:hidden">
          <div className="flex h-16 items-center justify-between gap-3 px-gutter">
            <div className="flex items-center gap-2 lg:hidden">
              <button
                ref={menuButtonRef}
                type="button"
                aria-expanded={drawerOpen}
                aria-controls="tiroir-admin"
                aria-label={tc("openMenu")}
                onClick={() => setDrawerOpen(true)}
                className="-ml-2 inline-flex size-11 items-center justify-center rounded-sm text-fg"
              >
                <ListIcon size={22} weight="light" aria-hidden="true" />
              </button>
              <Link href={adminHome} aria-label={t("home")} className="inline-flex text-fg">
                <Logo />
              </Link>
            </div>
            <p className="eyebrow hidden lg:block">{t("areaLabel")}</p>
            <div className="flex items-center gap-3">
              <GlobalSearch />
              <LanguageMenu className="hidden sm:block" />
              <span className="flex items-center gap-3">
                <MemberAvatar member={staff} size={36} tone="night" />
                <span className="hidden text-sm md:block">
                  <span className="block">{staff.firstName ?? t("account")}</span>
                  <span className="block text-xs text-fg-muted">{t(`roles.${staff.role}`)}</span>
                </span>
              </span>
            </div>
          </div>
        </header>
        <main id="contenu" className="flex-1 px-gutter pb-16 pt-10 lg:pt-12 print:p-0">
          {children}
        </main>
      </div>

      <Drawer groups={groups} pathname={pathname} open={drawerOpen} onClose={closeDrawer} onNavigate={() => setDrawerOpen(false)} />
    </>
  );
}

function NavGroups({
  groups,
  pathname,
  collapsed = false,
  onNavigate,
}: {
  groups: AdminNavGroup[];
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("Admin");
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <div key={group.key}>
          <p className={cn("eyebrow mb-2 px-3 text-fg-muted", collapsed && "sr-only")}>{t(`groups.${group.key}`)}</p>
          <ul className="space-y-1">
            {group.items.map((item) => (
              <li key={item.key}>
                <NavLink item={item} active={isAdminNavActive(item, pathname)} collapsed={collapsed} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Lien du menu : icône au trait fin, filet à gauche sur l'entrée active. */
function NavLink({ item, active, collapsed, onNavigate }: { item: AdminNavItem; active: boolean; collapsed: boolean; onNavigate?: () => void }) {
  const t = useTranslations("Admin.nav");
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? t(item.key) : undefined}
      className={cn(
        "relative flex min-h-11 items-center gap-4 rounded-sm px-3 transition-opacity duration-300",
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
      <item.Icon size={20} weight={active ? "regular" : "light"} aria-hidden="true" className="shrink-0" />
      <span className={cn("truncate text-sm", collapsed && "sr-only")}>{t(item.key)}</span>
    </Link>
  );
}

function SignOutButton({ collapsed = false }: { collapsed?: boolean }) {
  const t = useTranslations("Admin");
  return (
    <form action={signOut}>
      <button
        type="submit"
        title={collapsed ? t("signOut") : undefined}
        className={cn(
          "flex min-h-11 w-full items-center gap-4 rounded-sm px-3 text-sm opacity-70 transition-opacity duration-300 hover:opacity-100",
          collapsed && "justify-center px-0",
        )}
      >
        <SignOutIcon size={20} weight="light" aria-hidden="true" className="shrink-0" />
        <span className={cn(collapsed && "sr-only")}>{t("signOut")}</span>
      </button>
    </form>
  );
}

/** Tiroir (mobile) : tout le menu, la langue et la déconnexion. Échap ferme, le focus reste dans le tiroir. */
function Drawer({
  groups,
  pathname,
  open,
  onClose,
  onNavigate,
}: {
  groups: AdminNavGroup[];
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
            id="tiroir-admin"
            data-theme="dark"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("Admin.areaLabel")}
            className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] flex-col border-r border-line bg-bg text-fg pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
            initial={{ x: reduce ? 0 : "-100%", opacity: reduce ? 0 : 1 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: reduce ? 0 : "-100%", opacity: reduce ? 0 : 1 }}
            transition={transition}
          >
            <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-5">
              <span className="eyebrow">{t("Admin.areaLabel")}</span>
              <button
                type="button"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm border border-line text-fg"
                aria-label={t("Common.closeMenu")}
                onClick={onClose}
              >
                <XIcon size={20} weight="light" />
              </button>
            </div>
            <nav aria-label={t("Admin.areaLabel")} className="flex-1 overflow-y-auto overscroll-contain px-3 py-6">
              <NavGroups groups={groups} pathname={pathname} onNavigate={onNavigate} />
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
