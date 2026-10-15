import type { Icon } from "@phosphor-icons/react";
import {
  FacebookLogoIcon,
  InstagramLogoIcon,
  LinkedinLogoIcon,
  TiktokLogoIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react/ssr";
import { useTranslations } from "next-intl";
import { siteContact, siteSocial } from "@/config/site";
import { cn } from "@/lib/cn";

const icons: Record<(typeof siteSocial)[number]["network"], Icon> = {
  instagram: InstagramLogoIcon,
  facebook: FacebookLogoIcon,
  tiktok: TiktokLogoIcon,
  linkedin: LinkedinLogoIcon,
  whatsapp: WhatsappLogoIcon,
};

/**
 * Réseaux sociaux : carrés à filet fin, icônes Phosphor light, couleur du texte environnant.
 * Un compte non encore communiqué reste affiché, sans lien, avec la mention « Lien à venir ».
 */
export function SocialLinks({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  const t = useTranslations("Social");
  const box = size === "sm" ? "size-10" : "size-12";
  const iconSize = size === "sm" ? 18 : 20;

  return (
    <ul className={cn("flex items-center", size === "sm" ? "gap-1.5" : "gap-2.5", className)}>
      {siteSocial.map(({ network, label, url }) => {
        const Icon = icons[network];
        const href =
          network === "whatsapp" && !url && siteContact.whatsapp
            ? `https://wa.me/${siteContact.whatsapp.replace(/\D/g, "")}`
            : url;
        const content = (
          <>
            {/* Voile au survol : opacité uniquement */}
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-current opacity-0 transition-opacity duration-500 ease-soft group-hover:opacity-[0.08] group-focus-visible:opacity-[0.08]"
            />
            <Icon size={iconSize} weight="light" aria-hidden="true" />
          </>
        );
        const shape = cn(
          "group relative flex items-center justify-center rounded-sm border border-current/25",
          box,
        );
        return (
          <li key={network}>
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={shape}>
                {content}
              </a>
            ) : (
              <span role="img" aria-label={`${label} (${t("pending")})`} title={t("pending")} className={shape}>
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
