import Image from "next/image";
import type { SessionMember } from "@/lib/session";
import { cn } from "@/lib/cn";

/**
 * Avatar circulaire du membre connecté : photo principale, ou initiale en serif italique.
 * Seule exception aux rayons de 0 à 4 px, demandée pour l'avatar.
 */
export function MemberAvatar({ member, size = 40, className }: { member: SessionMember; size?: number; className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-soft ring-1 ring-line-strong/60 ring-offset-2 ring-offset-bg",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {member.avatarUrl ? (
        <Image src={member.avatarUrl} alt="" fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <span aria-hidden="true" className="font-serif text-lg italic leading-none text-fg">
          {member.firstName.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}
