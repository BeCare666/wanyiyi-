import type { Icon } from "@phosphor-icons/react";
import { ChampagneIcon, ChatTextIcon, MapPinIcon, ReceiptIcon, ShieldCheckIcon, TagIcon, UsersThreeIcon } from "@phosphor-icons/react/ssr";
import type { StaffPermission } from "@/lib/staff";

/** Entrée du menu de l'administration : clé de traduction (Admin.nav), adresse, icône, permission requise. */
export type AdminNavItem = {
  key: "members" | "verifications" | "moderation" | "evenings" | "venues" | "themes" | "payments";
  href: string;
  Icon: Icon;
  permission: StaffPermission;
};

/** Groupe de menus (11.1). Seuls les modules déjà livrés y figurent : aucun lien vers une page absente. */
export type AdminNavGroup = { key: "members" | "evenings" | "payments"; items: AdminNavItem[] };

export const adminHome = "/admin";

export const adminNav: AdminNavGroup[] = [
  {
    key: "members",
    items: [
      { key: "members", href: "/admin/membres", Icon: UsersThreeIcon, permission: "members.manage" },
      { key: "verifications", href: "/admin/verifications", Icon: ShieldCheckIcon, permission: "verifications.review" },
      // Modération des textes de profil (question 22, 22 octobre 2026)
      { key: "moderation", href: "/admin/moderation", Icon: ChatTextIcon, permission: "profile_texts.review" },
    ],
  },
  {
    key: "evenings",
    items: [
      { key: "evenings", href: "/admin/soirees", Icon: ChampagneIcon, permission: "events.manage" },
      { key: "venues", href: "/admin/lieux", Icon: MapPinIcon, permission: "events.manage" },
      // Thèmes des soirées (questions 4 et 21, 24 octobre 2026)
      { key: "themes", href: "/admin/themes", Icon: TagIcon, permission: "events.manage" },
    ],
  },
  {
    key: "payments",
    items: [{ key: "payments", href: "/admin/paiements", Icon: ReceiptIcon, permission: "payments.read" }],
  },
];

/** Menu visible pour ces permissions : entrées autorisées seulement, groupes vides retirés. */
export function visibleAdminNav(permissions: readonly StaffPermission[]): AdminNavGroup[] {
  return adminNav
    .map((group) => ({ ...group, items: group.items.filter((item) => permissions.includes(item.permission)) }))
    .filter((group) => group.items.length > 0);
}

export function isAdminNavActive(item: AdminNavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
