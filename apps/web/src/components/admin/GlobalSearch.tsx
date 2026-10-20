"use client";

import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useFormatter, useTranslations } from "next-intl";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { groupHits, hitStatusKey, isSearchShortcut, SEARCH_MIN_LENGTH, type SearchHit, searchHref } from "./search";
import { adminSearch } from "./searchAction";

/** Titre de secours : membre sans profil, soirée sans lieu, paiement sans référence. */
const untitled = {
  member: "verifications.noProfile",
  verification: "verifications.noProfile",
  evening: "evenings.noVenue",
  venue: "search.untitled",
  payment: "search.untitled",
} as const;

/** Délai avant d'interroger la base pendant la saisie (recherche instantanée, 11.3). */
const DEBOUNCE_MS = 250;

/**
 * Recherche globale de l'en-tête (section 11.1) : bouton, raccourci Ctrl+K (Cmd+K) ou « / »,
 * fenêtre avec champ en liste déroulante accessible (flèches, Entrée, Échap).
 */
export function GlobalSearch() {
  const t = useTranslations("Admin.search");
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (!open && isSearchShortcut(e, typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K /"
        className="inline-flex min-h-10 items-center gap-3 rounded-sm border border-line px-3 text-sm text-fg-muted hover:text-fg"
      >
        <MagnifyingGlassIcon size={18} weight="light" aria-hidden="true" />
        <span className="hidden md:inline">{t("button")}</span>
        <span className="sr-only md:hidden">{t("button")}</span>
        <kbd className="hidden rounded-sm border border-line px-1.5 font-sans text-xs lg:inline">Ctrl K</kbd>
      </button>
      {open && <SearchDialog onClose={close} />}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("Admin");
  const format = useFormatter();
  const router = useRouter();
  const listId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const groups = groupHits(hits);
  const ordered = groups.flatMap((g) => g.hits);

  // Fond figé, focus dans le champ, Tab gardé dans la fenêtre, Échap pour fermer
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>("input, button, a[href]");
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Recherche instantanée, après une courte pause de saisie ; une réponse périmée est ignorée
  useEffect(() => {
    const q = query.trim();
    if (q.length < SEARCH_MIN_LENGTH) return;
    let current = true;
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        const result = await adminSearch(q);
        if (!current) return;
        setError(!result.ok);
        setHits(result.ok ? result.hits : []);
        setActive(0);
      });
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const go = (hit: SearchHit) => {
    onClose();
    router.push(searchHref(hit));
  };

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (ordered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % ordered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + ordered.length) % ordered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = ordered[active];
      if (hit) go(hit);
    }
  };

  const short = query.trim().length < SEARCH_MIN_LENGTH;
  const shown = short ? [] : groups;
  const optionId = (index: number) => `${listId}-${index}`;
  const describe = (hit: SearchHit) => {
    const status = hitStatusKey(hit);
    const parts = [status ? t(status) : hit.detail];
    if (hit.at && (hit.kind === "evening" || hit.kind === "payment" || hit.kind === "verification")) {
      parts.push(format.dateTime(new Date(hit.at), { day: "numeric", month: "short", year: "numeric" }));
    }
    return parts.filter(Boolean).join(" · ");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div aria-hidden="true" className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("search.title")}
        className="relative w-full max-w-xl border border-line bg-bg-elevated text-fg"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <MagnifyingGlassIcon size={20} weight="light" aria-hidden="true" className="shrink-0 text-fg-muted" />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={shown.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown.length > 0 ? optionId(active) : undefined}
            aria-label={t("search.label")}
            placeholder={t("search.placeholder")}
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            className="min-h-14 w-full bg-transparent text-base text-fg placeholder:text-fg-muted/70 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("search.close")}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:text-fg"
          >
            <XIcon size={18} weight="light" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
          <p role="status" className={cn("px-4 py-3 text-sm text-fg-muted", shown.length > 0 && "sr-only")}>
            {short
              ? t("search.hint")
              : error
                ? t("errors.unavailable")
                : pending && hits.length === 0
                  ? t("search.searching")
                  : t("search.count", { count: ordered.length })}
          </p>
          <ul id={listId} role="listbox" aria-label={t("search.title")}>
            {shown.map((group) => (
              <li key={group.kind} role="presentation">
                <p className="eyebrow px-4 pb-1 pt-4 text-fg-muted" aria-hidden="true">
                  {t(`search.kinds.${group.kind}`)}
                </p>
                <ul role="group" aria-label={t(`search.kinds.${group.kind}`)}>
                  {group.hits.map((hit) => {
                    const i = ordered.indexOf(hit);
                    return (
                      <li
                        key={`${hit.kind}-${hit.id}`}
                        id={optionId(i)}
                        role="option"
                        aria-selected={i === active}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(hit)}
                        className={cn("cursor-pointer border-l px-4 py-3", i === active ? "border-accent bg-bg-soft" : "border-transparent")}
                      >
                        <span className="block text-sm font-medium">{hit.title ?? t(untitled[hit.kind])}</span>
                        <span className="block text-xs text-fg-muted">{describe(hit)}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
