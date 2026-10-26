"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import type { ApiResult } from "@/lib/api";
import { cn } from "@/lib/cn";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

export type ChatMessage = { id: string; sender_id: string | null; body: string; created_at: string; is_system?: boolean };

/** Messages système du chat du couple (question 9) : code envoyé par la base, texte traduit ici. */
const systemCodes = [
  "counselor_access.requested",
  "counselor_access.accepted",
  "counselor_access.refused",
  "counselor_access.revoked",
  "counselor_access.granted",
  "couple.blocked",
  "couple.unblocked",
] as const;

export function systemKey(code: string): string | null {
  return (systemCodes as readonly string[]).includes(code) ? code.replace(".", "_") : null;
}

const knownErrors = new Set(["contact_blocked", "conversation_closed", "invalid_body", "not_member", "unavailable"]);

/**
 * Conversation en temps réel (questions 1 et 8 de la phase 3) : texte seulement ; les nouveaux
 * messages arrivent par Supabase Realtime, sous la même RLS que la lecture. L'envoi passe par la
 * base, qui refuse liens, adresses e-mail et numéros.
 */
export function ChatRoom({
  conversationId,
  memberId,
  initial,
  closed,
  send,
  names = {},
}: {
  conversationId: string;
  memberId: string;
  initial: ChatMessage[];
  closed: boolean;
  send: (conversationId: string, body: string) => Promise<ApiResult<string>>;
  /** Prénoms des participants, pour les messages système. */
  names?: Record<string, string>;
}) {
  const t = useTranslations("Member.chat");
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowser();
    if (!supabase) return;
    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "app", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const m = payload.new as ChatMessage;
          setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (body === "") return;
    setError(null);
    startTransition(async () => {
      const result = await send(conversationId, body);
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      setDraft("");
      setMessages((list) =>
        list.some((x) => x.id === result.data) ? list : [...list, { id: result.data, sender_id: memberId, body, created_at: new Date().toISOString() }],
      );
    });
  };

  return (
    <section aria-label={t("label")} className="mt-8 border-t border-line pt-6">
      <ol aria-live="polite" className="max-h-[60svh] space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && <li className="text-sm text-fg-muted">{t("empty")}</li>}
        {messages.map((m) => {
          if (m.is_system) {
            const key = systemKey(m.body);
            return (
              <li key={m.id} className="text-center text-xs text-fg-muted">
                {key ? t(`system.${key}`, { name: (m.sender_id && names[m.sender_id]) || t("them") }) : null}
              </li>
            );
          }
          const mine = m.sender_id === memberId;
          return (
            <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <p className={cn("max-w-[80%] whitespace-pre-line rounded-sm px-4 py-2", mine ? "bg-fg text-bg" : "border border-line")}>
                <span className="sr-only">{mine ? t("me") : t("them")} : </span>
                {m.body}
              </p>
            </li>
          );
        })}
        <div ref={end} />
      </ol>

      {closed ? (
        <p className="mt-6 border-l border-line pl-4 text-sm text-fg-muted">{t("closed")}</p>
      ) : (
        <form onSubmit={submit} className="mt-6">
          <label className="block">
            <span className="sr-only">{t("message")}</span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder={t("placeholder")}
              className={cn(fieldClass, "resize-y text-base")}
            />
          </label>
          <p className="mt-2 text-xs text-fg-muted">{t("rules")}</p>
          <div className="mt-3">
            <Button type="submit" disabled={pending || draft.trim() === ""}>
              {t("send")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-4 border-l border-accent pl-4 text-sm">
              {t(`errors.${error}`)}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
