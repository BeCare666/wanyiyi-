"use client";

import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, Fragment, type KeyboardEvent, useEffect, useRef, useState, useTransition } from "react";
import type { ApiResult } from "@/lib/api";
import { cn } from "@/lib/cn";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { chatDayKey, groupChat, isReadByPartner } from "./chatLayout";
import { systemMessage } from "./chatSystem";
import { ReportForm, type ReportReason } from "./ReportForm";

export type ChatMessage = { id: string; sender_id: string | null; body: string; created_at: string; is_system?: boolean };

const knownErrors = new Set(["contact_blocked", "conversation_closed", "invalid_body", "not_member", "unavailable"]);

const TIME_ZONE = "Africa/Porto-Novo";

/**
 * Conversation en temps réel (questions 1 et 8 de la phase 3), présentée façon WhatsApp
 * (06/11/2026) : bulles à droite pour moi, à gauche pour l'autre, heure et accusé de lecture dans
 * la bulle (✓ envoyé, ✓✓ lu), séparateur par jour, Entrée pour envoyer (Maj + Entrée : nouvelle
 * ligne). Texte seulement ; les nouveaux messages arrivent par Supabase Realtime, sous la même
 * RLS que la lecture. L'envoi passe par la base, qui refuse liens, adresses e-mail et numéros.
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
  partnerReadAt = null,
  markRead,
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
  /** Dernière lecture par l'autre membre : mes messages plus anciens sont « lus » (✓✓). */
  partnerReadAt?: string | null;
  /** Conversation lue : appelé quand un message de l'autre arrive pendant que la page est ouverte. */
  markRead?: (conversationId: string) => Promise<ApiResult<void>>;
}) {
  const t = useTranslations("Member.chat");
  const tj = useTranslations("Member.couple.journey");
  const format = useFormatter();
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
          if (markRead && !m.is_system && m.sender_id !== memberId) void markRead(conversationId);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, markRead, memberId]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const body = draft.trim();
    if (body === "" || pending) return;
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

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const now = new Date();
  const dayLabel = (iso: string) => {
    const key = chatDayKey(iso, TIME_ZONE);
    if (key === chatDayKey(now.toISOString(), TIME_ZONE)) return t("today");
    if (key === chatDayKey(new Date(now.getTime() - 86_400_000).toISOString(), TIME_ZONE)) return t("yesterday");
    return format.dateTime(new Date(iso), { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE });
  };
  const time = (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });

  return (
    <section aria-label={t("label")} className="mt-8 overflow-hidden rounded-md border border-line bg-bg-elevated">
      <ol aria-live="polite" className="flex max-h-[65svh] min-h-64 flex-col gap-1 overflow-y-auto px-3 py-4 sm:px-5">
        {messages.length === 0 && <li className="m-auto max-w-xs py-10 text-center text-sm text-fg-muted">{t("empty")}</li>}
        {groupChat(messages, TIME_ZONE).map(({ message: m, newDay, firstOfGroup }) => {
          const separator = newDay && (
            <li className="my-3 flex justify-center">
              <span className="rounded-full bg-bg px-3 py-1 text-xs text-fg-muted first-letter:uppercase">{dayLabel(m.created_at)}</span>
            </li>
          );
          if (m.is_system) {
            const sys = systemMessage(m.body);
            return (
              <Fragment key={m.id}>
                {separator}
              <li className="my-2 flex justify-center">
                <span className="max-w-[85%] rounded-md bg-bg px-3 py-1.5 text-center text-xs text-fg-muted">
                  {sys ? t(`system.${sys.key}`, { name: (m.sender_id && names[m.sender_id]) || t("them"), step: sys.step ? tj(sys.step) : "" }) : null}
                </span>
              </li>
              </Fragment>
            );
          }
          const mine = m.sender_id === memberId;
          const read = mine && isReadByPartner(m, messages, memberId, partnerReadAt);
          return (
            <Fragment key={m.id}>
              {separator}
            <li className={cn("flex flex-col", mine ? "items-end" : "items-start", firstOfGroup && "mt-2")}>
              {showNames && !mine && firstOfGroup && (
                <span aria-hidden="true" className="mb-1 px-2 text-xs font-medium text-fg-muted">
                  {(m.sender_id && names[m.sender_id]) || t("them")}
                </span>
              )}
              <div
                className={cn(
                  "relative max-w-[82%] rounded-2xl px-3 pb-1.5 pt-2 shadow-sm sm:max-w-[70%]",
                  mine ? "bg-accent text-accent-fg" : "border border-line bg-bg text-fg",
                  firstOfGroup && (mine ? "rounded-tr-sm" : "rounded-tl-sm"),
                )}
              >
                <span className="sr-only">{mine ? t("me") : (showNames && m.sender_id && names[m.sender_id]) || t("them")} : </span>
                <span className="whitespace-pre-line break-words">{m.body}</span>
                <span className={cn("float-right ml-3 mt-1.5 inline-flex translate-y-0.5 items-center gap-1 text-[0.7rem] leading-none tabular-nums", mine ? "opacity-80" : "text-fg-muted")}>
                  <time dateTime={m.created_at}>{time(m.created_at)}</time>
                  {mine && (
                    <>
                      <span aria-hidden="true">{read ? "✓✓" : "✓"}</span>
                      <span className="sr-only">{read ? t("read") : t("sent")}</span>
                    </>
                  )}
                </span>
              </div>
              {report && !mine && reporting !== m.id && (
                <button type="button" onClick={() => setReporting(m.id)} className="min-h-8 px-2 text-xs text-fg-muted underline-offset-4 hover:underline">
                  {t("reportMessage")}
                </button>
              )}
              {report && reporting === m.id && (
                <ReportForm onSubmit={(reason, details) => report(conversationId, m.id, reason, details)} onClose={() => setReporting(null)} />
              )}
            </li>
            </Fragment>
          );
        })}
        <div ref={end} />
      </ol>

      {closed ? (
        <p className="border-t border-line px-4 py-4 text-sm text-fg-muted">{t("closed")}</p>
      ) : (
        <form onSubmit={submit} className="border-t border-line bg-bg px-3 py-3 sm:px-4">
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t("message")}</span>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={Math.min(5, Math.max(1, draft.split("\n").length))}
                maxLength={2000}
                placeholder={t("placeholder")}
                className="block w-full resize-none rounded-3xl border border-line bg-bg-elevated px-4 py-3 text-base leading-snug text-fg outline-none placeholder:text-fg-muted focus:border-fg"
              />
            </label>
            <button
              type="submit"
              disabled={pending || draft.trim() === ""}
              aria-label={t("send")}
              className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition-opacity disabled:opacity-40"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="currentColor">
                <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8z" />
              </svg>
            </button>
          </div>
          <p className="mt-2 px-2 text-xs text-fg-muted">{t("rules")}</p>
          {error && (
            <p role="alert" className="mt-3 border-l border-accent pl-4 text-sm">
              {t(`errors.${error}`)}
            </p>
          )}
        </form>
      )}

      {report && (
        <div className="border-t border-line px-4 py-2">
          {reporting === "conversation" ? (
            <ReportForm onSubmit={(reason, details) => report(conversationId, null, reason, details)} onClose={() => setReporting(null)} />
          ) : (
            <button type="button" onClick={() => setReporting("conversation")} className="min-h-11 text-sm text-fg-muted underline-offset-4 hover:underline">
              {t("reportConversation")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
