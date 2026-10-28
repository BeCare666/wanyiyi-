import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import type { Localized, ProviderCategory } from "@/lib/providers";
import { getStaffMember } from "@/lib/staff";
import { createSupabaseServer } from "@/lib/supabase/server";
import { ProviderForm } from "../ProviderForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.nav");
  return { title: t("providers") };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AdminProvider = {
  id: string;
  name: string;
  category: string;
  description: Localized | null;
  phone: string | null;
  whatsapp: string | null;
  city: string;
  district: string | null;
  price_range: string | null;
  image_url: string | null;
  is_active: boolean;
  is_demo: boolean;
  contacts: number;
};

/** Fiche d'un prestataire (phase 4, question 2) : modification, image, désactivation. */
export default async function AdminProviderPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const staff = await getStaffMember();
  if (!staff?.permissions.includes("providers.manage")) notFound();
  const t = await getTranslations("Admin");
  const supabase = await createSupabaseServer();
  if (!supabase) notFound();
  const [{ data: rows }, { data: categories }] = await Promise.all([
    supabase.rpc("admin_provider", { p_id: id }),
    supabase.from("provider_categories").select("key, name, position, is_active").order("position"),
  ]);
  const provider = ((rows ?? []) as AdminProvider[])[0];
  if (!provider) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <p>
        <Link href="/admin/prestataires" className="text-sm text-link underline-offset-4 hover:underline">
          {t("providers.back")}
        </Link>
      </p>
      <header className="mt-6">
        <p className="eyebrow">{t("nav.providers")}</p>
        <h1 className="mt-4 text-4xl">{provider.name}</h1>
        <p className="mt-4 text-fg-muted">
          {provider.is_active ? t("providers.active") : t("providers.inactive")} · {t("providers.contactsCount", { count: provider.contacts })}
          {provider.is_demo && ` · ${t("providers.demo")}`}
        </p>
      </header>
      <div className="mt-10">
        <ProviderForm
          id={provider.id}
          categories={(categories ?? []) as ProviderCategory[]}
          active={provider.is_active}
          imageUrl={provider.image_url}
          initial={{
            name: provider.name,
            category: provider.category,
            description: provider.description ?? {},
            phone: provider.phone ?? "",
            whatsapp: provider.whatsapp ?? "",
            city: provider.city,
            district: provider.district ?? "",
            priceRange: provider.price_range ?? "",
            isDemo: provider.is_demo,
          }}
        />
      </div>
    </div>
  );
}
