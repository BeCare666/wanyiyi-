"use client";

import { ArrowRightIcon, CaretDownIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { sectionIds } from "@/config/site";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { durations } from "@/lib/motion";
import type { SessionMember } from "@/lib/session";
import { useActiveSection } from "@/lib/useActiveSection";
import { useDismiss } from "@/lib/useDismiss";
import { usePresence } from "@/lib/usePresence";
import { LanguageMenu } from "./LanguageSwitcher";
import { MemberAvatar } from "./MemberAvatar";
import { MobileNav } from "./MobileNav";
import { desktopMore, desktopPrimary, isNavActive, memberSpaceHref, type NavItem, trackedSections } from "./navItems";

/**
 * En-tête de la vitrine.
 * Ordinateur (1024 px et plus) : logo, menus avec icônes, menu « La maison », langue, action.
 * Mobile : logo, langue et action en haut ; la navigation passe dans la barre du bas (MobileNav).
 * Action : « Devenir membre » pour un visiteur, avatar circulaire pour un membre connecté.
 */
export function SiteHeader({ member }: { member: SessionMember | null }) {
  const t = useTranslations();
  const pathname = usePathname();
  const activeSection = useActiveSection(trackedSections, pathname === "/");
  const [compact, setCompact] = useState(false);

  // En-tête compact après 24 px de défilement (écouteur passif, sans bibliothèque d'animation)
  useEffect(() => {
    const update = () => setCompact(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40">
        {/* Fond qui apparaît au défilement : opacité uniquement */}
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 border-b border-line bg-bg/94 backdrop-blur-md transition-opacity duration-500 ease-soft",
            compact ? "opacity-100" : "opacity-0",
          )}
        />
        <div className="relative mx-auto flex h-16 max-w-[90rem] items-center justify-between gap-4 px-gutter lg:h-24 lg:gap-8">
          <div
            className={cn(
              "shrink-0 origin-left transition-transform duration-500 ease-soft",
              compact ? "scale-[0.92]" : "scale-100",
            )}
          >
            <Link href="/" aria-label={t("Common.logoAlt")} className="inline-flex text-fg">
              <Logo />
            </Link>
          </div>

          <nav aria-label={t("Common.menu")} className="hidden lg:block">
            <ul className="flex items-center gap-5 xl:gap-9">
              {desktopPrimary.map((item) => (
                <li key={item.key} className={cn(item.key === "evenings" && "hidden xl:block")}>
                  <DesktopLink item={item} active={isNavActive(item, pathname, activeSection, desktopPrimary)} />
                </li>
              ))}
              <li>
                <MoreMenu pathname={pathname} activeSection={activeSection} />
              </li>
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3 lg:gap-5">
            <LanguageMenu />
            {member ? (
              <Link href={memberSpaceHref} aria-label={t("Nav.account")} className="inline-flex rounded-full">
                <MemberAvatar member={member} size={36} />
              </Link>
            ) : (
              <>
                {/* Connexion à côté de « Devenir membre » (30 octobre 2026) : lien sur téléphone, bouton sur grand écran */}
                <Link
                  href="/connexion"
                  className="px-1 text-xs font-medium tracking-[0.06em] uppercase underline-offset-4 hover:underline sm:text-[0.6875rem] sm:tracking-[0.12em] xl:hidden"
                >
                  {t("Common.signIn")}
                </Link>
                <span className="hidden xl:flex">
                  <ButtonLink href="/connexion" variant="secondary">
                    {t("Common.signIn")}
                  </ButtonLink>
                </span>
                {/* Enveloppes : la classe inline-flex du bouton l'emporterait sur hidden */}
                <span className="flex xl:hidden">
                  <ButtonLink href="/inscription" size="sm">
                    {t("Common.becomeMember")}
                  </ButtonLink>
                </span>
                <span className="hidden xl:flex">
                  <ButtonLink href="/inscription">{t("Common.becomeMember")}</ButtonLink>
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      <MobileNav member={member} pathname={pathname} activeSection={activeSection} />
    </>
  );
}

function DesktopLink({ item, active }: { item: NavItem; active: boolean }) {
  const t = useTranslations("Nav");
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-sm text-fg transition-opacity duration-300",
        active ? "opacity-100" : "opacity-70 hover:opacity-100",
      )}
    >
      <item.Icon size={18} weight="light" aria-hidden="true" className="shrink-0" />
      <span className={cn("link-rule", active && "after:!scale-x-100")}>{t(item.key)}</span>
    </Link>
  );
}

/** Menu « La maison » : les autres rubriques, avec une courte description, et la prochaine soirée. */
function MoreMenu({ pathname, activeSection }: { pathname: string; activeSection: string | null }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { mounted, visible } = usePresence(open, durations.fast * 1000);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = useCallback((fromKeyboard: boolean) => {
    setOpen(false);
    if (fromKeyboard) buttonRef.current?.focus();
  }, []);
  useDismiss(rootRef, open, close);

  const someActive = desktopMore.some(
    (item) => item.key !== "evenings" && isNavActive(item, pathname, activeSection, desktopMore),
  );

  return (
    // Pas de position relative ici : le panneau se centre sur la largeur de l'en-tête
    <div ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-sm text-fg transition-opacity duration-300",
          open || someActive ? "opacity-100" : "opacity-70 hover:opacity-100",
        )}
      >
        <span className={cn("link-rule", (open || someActive) && "after:!scale-x-100")}>{t("Nav.more")}</span>
        <CaretDownIcon
          size={12}
          weight="light"
          aria-hidden="true"
          className={cn("transition-transform duration-300 ease-soft", open && "rotate-180")}
        />
      </button>

      {mounted && (
          <div
            id={panelId}
            className={cn(
              "absolute inset-x-0 top-full z-50 flex justify-center px-gutter transition-[opacity,translate] duration-300 ease-soft",
              visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
            )}
          >
            <div className="grid w-full max-w-[52rem] grid-cols-[1fr_16rem] border border-line-strong/40 bg-bg-elevated shadow-[0_40px_80px_-40px_rgb(14_13_16/0.4)]">
            <ul className="grid grid-cols-2 gap-x-2 p-4">
              {desktopMore.map((item) => {
                const active = isNavActive(item, pathname, activeSection, desktopMore);
                return (
                  <li key={item.key} className={cn(item.key === "evenings" && "xl:hidden")}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className="group flex gap-4 rounded-sm p-3 hover:bg-bg-soft"
                    >
                      <span
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-sm border",
                          active ? "border-fg text-fg" : "border-line text-fg/80",
                        )}
                      >
                        <item.Icon size={20} weight="light" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-serif text-lg leading-snug text-fg">{t(`Nav.${item.key}`)}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">
                          {t(`Nav.hints.${item.key}`)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <Link
              href={`/#${sectionIds.upcoming}`}
              onClick={() => setOpen(false)}
              className="group surface-night relative flex min-h-72 flex-col justify-end overflow-hidden bg-night p-6 text-ivory"
            >
              <Image
                src="/images/vitrine/soiree-table.jpg"
                alt=""
                fill
                sizes="240px"
                quality={60}
                className="object-cover opacity-70 transition-transform duration-700 ease-soft group-hover:scale-[1.04]"
              />
              <span aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-night via-night/40 to-transparent" />
              <span className="relative eyebrow text-ivory/80">{t("Nav.evenings")}</span>
              <span className="relative mt-3 flex items-center gap-3 font-serif text-2xl leading-tight">
                {t("Common.nextEvening")}
                <ArrowRightIcon size={18} weight="light" aria-hidden="true" className="transition-transform duration-500 ease-soft group-hover:translate-x-1" />
              </span>
            </Link>
            </div>
          </div>
      )}
    </div>
  );
}
