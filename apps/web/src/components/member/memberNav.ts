import type { Icon } from "@phosphor-icons/react";
import {
  BellIcon,
  ChampagneIcon,
  GearSixIcon,
  HeartIcon,
  HouseLineIcon,
  IdentificationCardIcon,
  ScrollIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/ssr";

/** Entrée de l'espace membre : clé de traduction (Member.nav), adresse et icône. */
export type MemberNavItem = {
  key: "dashboard" | "evenings" | "matches" | "profile" | "verification" | "notifications" | "settings" | "rules";
  href: string;
  Icon: Icon;
};

export const memberHome = "/espace";

/** Espace du couple (9.5) : hors menu, ouvert depuis « Mes matchs », le tableau de bord et les notifications. */
export const coupleSpace = "/espace/couple";

const items = {
  dashboard: { key: "dashboard", href: memberHome, Icon: HouseLineIcon },
  evenings: { key: "evenings", href: "/espace/soirees", Icon: ChampagneIcon },
  matches: { key: "matches", href: "/espace/matchs", Icon: HeartIcon },
  profile: { key: "profile", href: "/espace/profil", Icon: IdentificationCardIcon },
  verification: { key: "verification", href: "/espace/verification", Icon: ShieldCheckIcon },
  notifications: { key: "notifications", href: "/espace/notifications", Icon: BellIcon },
  settings: { key: "settings", href: "/espace/parametres", Icon: GearSixIcon },
  rules: { key: "rules", href: "/reglement", Icon: ScrollIcon },
} satisfies Record<MemberNavItem["key"], MemberNavItem>;

export const memberNav = items;

/** Les 4 sections principales : barre basse (mobile) et haut de la barre latérale (section 6.1). */
export const memberPrimary: MemberNavItem[] = [items.dashboard, items.evenings, items.matches, items.profile];

/** Les autres entrées : bas de la barre latérale et tiroir mobile. */
export const memberSecondary: MemberNavItem[] = [items.verification, items.notifications, items.settings, items.rules];

/** Entrée active : la page elle-même ou l'une de ses sous-pages (le tableau de bord seulement sur sa page). */
export function isMemberNavActive(item: MemberNavItem, pathname: string): boolean {
  if (item.href === memberHome) return pathname === memberHome;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
