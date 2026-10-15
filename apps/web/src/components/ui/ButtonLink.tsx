import type { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "inverse";

const variants: Record<Variant, { base: string; veil: string }> = {
  primary: { base: "bg-accent text-accent-fg", veil: "bg-ink/25" },
  secondary: { base: "border border-fg text-fg", veil: "bg-accent-soft/60" },
  inverse: { base: "border border-ivory/70 text-ivory", veil: "bg-ivory/15" },
};

type Size = "md" | "sm";

const sizes: Record<Size, string> = {
  md: "min-h-12 px-7 text-xs tracking-[0.16em]",
  sm: "min-h-10 px-3 text-[0.6875rem] tracking-[0.06em] sm:px-4 sm:tracking-[0.12em]",
};

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: Variant; size?: Size };

/**
 * Lien d'action. Le survol fait apparaître un voile en fondu (opacity uniquement),
 * sans changement de couleur animé ni déplacement. Coins de 2 px, pas d'ombre.
 */
export function ButtonLink({ variant = "primary", size = "md", className, children, ...props }: ButtonLinkProps) {
  const v = variants[variant];
  return (
    <Link
      {...props}
      className={cn(
        "group relative isolate inline-flex whitespace-nowrap items-center justify-center gap-3 overflow-hidden rounded-sm font-medium uppercase",
        sizes[size],
        v.base,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 ease-soft group-hover:opacity-100 group-focus-visible:opacity-100",
          v.veil,
        )}
      />
      {children}
    </Link>
  );
}
