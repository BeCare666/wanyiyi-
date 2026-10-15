import { EnvelopeIcon, PhoneIcon, WhatsappLogoIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/ui/Container";
import { siteContact } from "@/config/site";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Contact" });
  return { title: t("eyebrow") };
}

export default async function ContactPage() {
  const t = await getTranslations();
  const toComplete = t("Common.toComplete");

  const rows = [
    { key: "phone", Icon: PhoneIcon, value: siteContact.phone, href: siteContact.phone && `tel:${siteContact.phone}` },
    { key: "email", Icon: EnvelopeIcon, value: siteContact.email, href: siteContact.email && `mailto:${siteContact.email}` },
    {
      key: "whatsapp",
      Icon: WhatsappLogoIcon,
      value: siteContact.whatsapp,
      href: siteContact.whatsapp && `https://wa.me/${siteContact.whatsapp.replace(/\D/g, "")}`,
    },
  ] as const;

  return (
    <section className="pb-section pt-36 lg:pt-44">
      <Container className="grid gap-16 lg:grid-cols-12 lg:gap-10">
        <header className="lg:col-span-6">
          <p className="eyebrow flex items-center gap-4">
            <span aria-hidden="true" className="block h-px w-10 bg-accent" />
            {t("Contact.eyebrow")}
          </p>
          <h1 className="mt-8 text-5xl">{t("Contact.title")}</h1>
          <p className="mt-8 max-w-measure text-lg text-fg-muted">{t("Contact.intro")}</p>
        </header>

        <dl className="border-t border-line lg:col-span-5 lg:col-start-8 lg:mt-24">
          {rows.map(({ key, Icon, value, href }) => (
            <div key={key} className="grid grid-cols-[2rem_8rem_1fr] items-center gap-4 border-b border-line py-6">
              <Icon size={22} weight="light" aria-hidden="true" className="text-accent" />
              <dt className="eyebrow text-fg">{t(`Footer.${key}`)}</dt>
              <dd>
                {value && href ? (
                  <a href={href} className="link-rule">
                    {value}
                  </a>
                ) : (
                  <span className="text-fg-muted">{toComplete}</span>
                )}
              </dd>
            </div>
          ))}
          <p className="pt-6 text-sm text-fg-muted">{t("Contact.hours")}</p>
        </dl>
      </Container>
    </section>
  );
}
