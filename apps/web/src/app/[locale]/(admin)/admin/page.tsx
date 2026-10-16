import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { visibleAdminNav } from "@/components/admin/adminNav";
import { Link } from "@/i18n/navigation";
import { getStaffMember } from "@/lib/staff";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin");
  return { title: t("home") };
}

/** Accueil de l'administration : les modules ouverts au rôle de la personne. */
export default async function AdminHomePage() {
  const t = await getTranslations("Admin");
  const staff = await getStaffMember();
  if (!staff) return null;
  const groups = visibleAdminNav(staff.permissions);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-4xl">{t("home")}</h1>
      {groups.length === 0 ? (
        <p className="mt-10 max-w-measure text-fg-muted">{t("noModule")}</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="mt-10">
            <h2 className="eyebrow">{t(`groups.${group.key}`)}</h2>
            <ul className="mt-4 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => (
                <li key={item.key} className="bg-bg">
                  <Link href={item.href} className="flex min-h-24 items-center gap-4 px-6 py-5 transition-opacity duration-300 hover:opacity-80">
                    <item.Icon size={24} weight="light" aria-hidden="true" />
                    <span>
                      <span className="block font-serif text-xl">{t(`nav.${item.key}`)}</span>
                      <span className="mt-1 block text-sm text-fg-muted">{t(`navHelp.${item.key}`)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
