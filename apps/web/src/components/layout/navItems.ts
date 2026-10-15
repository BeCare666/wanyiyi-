import type { Icon } from "@phosphor-icons/react";
import {
  ChampagneIcon,
  EnvelopeSimpleIcon,
  FeatherIcon,
  HandHeartIcon,
  HouseLineIcon,
  PathIcon,
  QuestionIcon,
  ScrollIcon,
  ShieldCheckIcon,
  SignatureIcon,
} from "@phosphor-icons/react/ssr";
import { sectionIds } from "@/config/site";

/** Clé de traduction (namespace Nav), adresse, icône et section de la page d'accueil visée. */
export type NavItem = {
  key: "home" | "about" | "evenings" | "faq" | "promise" | "journey" | "safety" | "support" | "contact" | "rules";
  href: string;
  Icon: Icon;
  section?: string;
};

export const nav = {
  home: { key: "home", href: "/", Icon: HouseLineIcon },
  about: { key: "about", href: "/a-propos", Icon: FeatherIcon },
  evenings: { key: "evenings", href: `/#${sectionIds.evenings}`, Icon: ChampagneIcon, section: sectionIds.evenings },
  faq: { key: "faq", href: `/#${sectionIds.faq}`, Icon: QuestionIcon, section: sectionIds.faq },
  promise: { key: "promise", href: `/#${sectionIds.promise}`, Icon: SignatureIcon, section: sectionIds.promise },
  journey: { key: "journey", href: `/#${sectionIds.journey}`, Icon: PathIcon, section: sectionIds.journey },
  safety: { key: "safety", href: `/#${sectionIds.safety}`, Icon: ShieldCheckIcon, section: sectionIds.safety },
  support: { key: "support", href: `/#${sectionIds.support}`, Icon: HandHeartIcon, section: sectionIds.support },
  contact: { key: "contact", href: "/contact", Icon: EnvelopeSimpleIcon },
  rules: { key: "rules", href: "/reglement", Icon: ScrollIcon },
} satisfies Record<NavItem["key"], NavItem>;

/** Barre du haut (ordinateur). « Les soirées » n'y figure qu'à partir de 1280 px. */
export const desktopPrimary: NavItem[] = [nav.home, nav.about, nav.evenings, nav.faq];

/** Menu déroulant « La maison » (ordinateur). */
export const desktopMore: NavItem[] = [nav.evenings, nav.promise, nav.journey, nav.safety, nav.support, nav.contact, nav.rules];

/** Barre du bas (mobile), avant le bouton Menu. */
export const mobileTabs: NavItem[] = [nav.home, nav.evenings, nav.about, nav.faq];

/** Tiroir mobile : la navigation complète. */
export const drawerItems: NavItem[] = [
  nav.home,
  nav.about,
  nav.evenings,
  nav.promise,
  nav.journey,
  nav.safety,
  nav.support,
  nav.faq,
  nav.contact,
  nav.rules,
];

/** Liens de section de la page d'accueil (pied de page). */
export const homeSections: NavItem[] = [nav.promise, nav.journey, nav.evenings, nav.safety, nav.support, nav.faq];

/** Toutes les sections suivies pendant le défilement de la page d'accueil. */
export const trackedSections = homeSections.map((item) => item.section as string);

/** Espace membre (phase 2), cible de l'avatar quand un membre est connecté. */
export const memberSpaceHref = "/espace";

/**
 * Entrée active : la page courante, ou, sur l'accueil, la section au milieu de l'écran.
 * « Accueil » reste actif tant qu'aucune autre entrée de la même liste ne l'est.
 */
export function isNavActive(item: NavItem, pathname: string, activeSection: string | null, list: readonly NavItem[]) {
  if (item.section) return pathname === "/" && activeSection === item.section;
  if (item.href === "/") return pathname === "/" && !list.some((other) => other.section && other.section === activeSection);
  return pathname === item.href;
}
