"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Button, fieldClass } from "@/components/ui/Button";
import type { ApiResult } from "@/lib/api";
import { cn } from "@/lib/cn";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { systemMessage } from "./chatSystem";
import { ReportForm, type ReportReason } from "./ReportForm";

export type ChatMessage = { id: string; sender_id: string | null; body: string; created_at: string; is_system?: boolean };


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
  showNames = false,
  report,
}: {
  conversationId: string;
  memberId: string;
  initial: ChatMessage[];
  closed: boolean;
  send: (conversationId: string, body: string) => Promise<ApiResult<string>>;
  /** Prénoms des participants, pour les messages système. */
  names?: Record<string, string>;
  /** Conversation à trois (conseiller présent) : prénom au-dessus des messages des autres. */
  showNames?: boolean;
  /** Signalement (question 11) : d'un message (son identifiant) ou de toute la conversation (null). */
  report?: (conversationId: string, messageId: string | null, reason: ReportReason, details: string) => Promise<ApiResult<string>>;
}) {
  const t = useTranslations("Member.chat");
  const tj = useTranslations("Member.couple.journey");
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  /** Signalement ouvert : identifiant du message, « conversation », ou rien. */
  const [reporting, setReporting] = useState<string | null>(null);

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
            const sys = systemMessage(m.body);
            return (
              <li key={m.id} className="text-center text-xs text-fg-muted">
                {sys
                  ? t(`system.${sys.key}`, { name: (m.sender_id && names[m.sender_id]) || t("them"), step: sys.step ? tj(sys.step) : "" })
                  : null}
              </li>
            );
          }
          const mine = m.sender_id === memberId;
          return (
            <li key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
              {showNames && !mine && (
                <span aria-hidden="true" className="mb-1 text-xs text-fg-muted">
                  {(m.sender_id && names[m.sender_id]) || t("them")}
                </span>
              )}
              <p className={cn("max-w-[80%] whitespace-pre-line rounded-sm px-4 py-2", mine ? "bg-fg text-bg" : "border border-line")}>
                <span className="sr-only">{mine ? t("me") : (showNames && m.sender_id && names[m.sender_id]) || t("them")} : </span>
                {m.body}
              </p>
              {report && !mine && reporting !== m.id && (
                <button type="button" onClick={() => setReporting(m.id)} className="mt-1 min-h-8 text-xs text-fg-muted underline-offset-4 hover:underline">
                  {t("reportMessage")}
                </button>
              )}
              {report && reporting === m.id && (
                <ReportForm onSubmit={(reason, details) => report(conversationId, m.id, reason, details)} onClose={() => setReporting(null)} />
              )}
            </li>
          );
        })}
        <div ref={end} />
      </ol>

      {report && (
        <div className="mt-4">
          {reporting === "conversation" ? (
            <ReportForm onSubmit={(reason, details) => report(conversationId, null, reason, details)} onClose={() => setReporting(null)} />
          ) : (
            <button type="button" onClick={() => setReporting("conversation")} className="min-h-11 text-sm text-fg-muted underline-offset-4 hover:underline">
              {t("reportConversation")}
            </button>
          )}
        </div>
      )}

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
