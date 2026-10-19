import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { VenueForm } from "./VenueForm";
import type { VenueRow } from "./venues";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("venues") };
}

/** Lieux des soirées (section 11.2-5). Pour la démonstration : lieux fictifs seulement. */
export default async function AdminVenuesPage() {
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("events.manage")) notFound();
  const t = await getTranslations("Admin");
  const supabase = await createSupabaseServer();
  const result = supabase ? await supabase.from("venues").select("id, name, address, city, is_partner").order("name") : null;
  const venues = (result?.data as VenueRow[] | null) ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="eyebrow">{t("groups.evenings")}</p>
        <h1 className="mt-4 text-4xl">{t("nav.venues")}</h1>
        <p className="mt-4 max-w-measure text-fg-muted">{t("venues.intro")}</p>
      </header>

      {!result || result.error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : venues.length === 0 ? (
        <p className="mt-10 border-t border-line pt-8 text-fg-muted">{t("venues.empty")}</p>
      ) : (
        <table className="mt-10 w-full border-collapse text-left text-sm">
          <caption className="sr-only">{t("nav.venues")}</caption>
          <thead className="hidden border-b border-line-strong md:table-header-group">
            <tr>
              <th scope="col" className="py-3 pr-4 font-medium">{t("venues.form.name")}</th>
              <th scope="col" className="py-3 pr-4 font-medium">{t("venues.form.address")}</th>
              <th scope="col" className="py-3 font-medium md:text-right">{t("venues.form.city")}</th>
            </tr>
          </thead>
          <tbody>
            {venues.map((v) => (
              <tr key={v.id} className="grid gap-1 border-b border-line py-4 md:table-row md:py-0">
                <th scope="row" className="font-medium md:py-4 md:pr-4">
                  {v.name}
                  {v.is_partner && <span className="ml-2 font-normal text-fg-muted">{t("venues.partner")}</span>}
                </th>
                <td className="text-fg-muted md:py-4 md:pr-4">{v.address}</td>
                <td className="md:py-4 md:text-right">{v.city}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section aria-labelledby="new-venue" className="mt-12 border-t border-line pt-8">
        <h2 id="new-venue" className="text-2xl">{t("venues.new")}</h2>
        <div className="mt-6">
          <VenueForm />
        </div>
      </section>
    </div>
  );
}
