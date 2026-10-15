import { cn } from "@/lib/cn";

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  id?: string;
  className?: string;
  tone?: "default" | "inverse";
};

/** Surtitre en petites capitales, filet de couleur d.accent, titre serif. */
export function SectionHeading({ eyebrow, title, id, className, tone = "default" }: SectionHeadingProps) {
  return (
    <header className={cn("max-w-3xl", className)}>
      <p className={cn("eyebrow flex items-center gap-4", tone === "inverse" && "text-fg-inverse-muted")}>
        <span aria-hidden="true" className="block h-px w-10 bg-accent" />
        {eyebrow}
      </p>
      <h2 id={id} className="mt-6 text-3xl md:text-4xl">
        {title}
      </h2>
    </header>
  );
}
