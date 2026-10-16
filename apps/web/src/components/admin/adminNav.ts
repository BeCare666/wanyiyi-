import type { Icon } from "@phosphor-icons/react";
import { ShieldCheckIcon } from "@phosphor-icons/react/ssr";
import type { StaffPermission } from "@/lib/staff";

/** Entrée du menu de l'administration : clé de traduction (Admin.nav), adresse, icône, permission requise. */
export type AdminNavItem = {
  key: "verifications";
  href: string;
  Icon: Icon;
  permission: StaffPermission;
};

/** Groupe de menus (11.1). Seuls les modules déjà livrés y figurent : aucun lien vers une page absente. */
export type AdminNavGroup = { key: "members"; items: AdminNavItem[] };

export const adminHome = "/admin";

export const adminNav: AdminNavGroup[] = [
  {
    key: "members",
    items: [{ key: "verifications", href: "/admin/verifications", Icon: ShieldCheckIcon, permission: "verifications.review" }],
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
