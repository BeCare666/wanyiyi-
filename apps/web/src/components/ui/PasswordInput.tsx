"use client";

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { type ComponentProps, useState } from "react";
import { cn } from "@/lib/cn";
import { fieldClass } from "./Button";

/**
 * Champ de mot de passe avec un œil pour l'afficher ou le masquer (30 octobre 2026). Mêmes
 * propriétés qu'un champ ordinaire ; le type est géré ici.
 */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const t = useTranslations("Common");
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeSlashIcon : EyeIcon;
  return (
    <span className="relative block">
      <input {...props} type={visible ? "text" : "password"} className={cn(fieldClass, "pr-12", className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={t(visible ? "hidePassword" : "showPassword")}
        aria-pressed={visible}
        className="absolute right-0 bottom-1 inline-flex size-11 items-center justify-center text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"
      >
        <Icon aria-hidden="true" size={22} />
      </button>
    </span>
  );
}
