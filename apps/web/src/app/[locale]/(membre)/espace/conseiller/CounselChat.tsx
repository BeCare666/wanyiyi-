"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { type ChatMessage, ChatRoom } from "@/components/member/ChatRoom";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import type { ApiResult } from "@/lib/api";
import { cancelCounsel, closeCounsel, counselSend, payCounselMessage, requestCounsel } from "./actions";
import { counselNotice } from "./counsel";

const knownErrors = new Set(["not_validated", "already_requested", "not_pending", "not_found", "contact_blocked", "conversation_closed", "invalid_body", "nothing_to_pay", "unavailable"]);

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ApiResult<unknown>>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(knownErrors.has(result.error) ? result.error : "generic");
      router.refresh();
    });
  };
  return { error, pending, run };
}

function ErrorLine({ error }: { error: string | null }) {
  const t = useTranslations("Member.counsel.errors");
  return error ? (
    <p role="alert" className="mt-3 border-l border-accent pl-4 text-sm">
      {t(error)}
    </p>
  ) : null;
}

/** Demande seule : bouton, ou annulation tant qu'aucun conseiller n'est attribué. */
export function CounselRequest({ requestId }: { requestId: string | null }) {
  const t = useTranslations("Member.counsel");
  const { error, pending, run } = useAction();
  return (
    <div className="mt-8">
      {requestId ? (
        <Button variant="secondary" disabled={pending} onClick={() => run(() => cancelCounsel(requestId))}>
          {t("cancel")}
        </Button>
      ) : (
        <Button disabled={pending} onClick={() => run(() => requestCounsel())}>
          {t("request")}
        </Button>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/**
 * Discussion avec le conseiller attribué : messages gratuits restants, puis paiement de chaque
 * message du membre (le message est remis dans la discussion une fois payé).
 */
export function CounselChat({
  requestId,
  conversationId,
  memberId,
  initial,
  names,
  priceXof,
  freeLeft: initialFreeLeft,
}: {
  requestId: string;
  conversationId: string;
  memberId: string;
  initial: ChatMessage[];
  names: Record<string, string>;
  priceXof: number;
  freeLeft: number;
}) {
  const t = useTranslations("Member.counsel");
  const format = useFormatter();
  const [freeLeft, setFreeLeft] = useState(initialFreeLeft);
  const [toPay, setToPay] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, startPaying] = useTransition();
  const close = useAction();
  const price = format.number(priceXof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 });
  const notice = counselNotice(priceXof, freeLeft);

  const send = async (id: string, body: string) => {
    const result = await counselSend(id, body);
    if (result.ok && priceXof > 0) setFreeLeft((n) => Math.max(0, n - 1));
    return result;
  };

  const pay = () => {
    if (!toPay) return;
    setPayError(null);
    startPaying(async () => {
      const result = await payCounselMessage(conversationId, toPay);
      if (!result.ok) return setPayError(knownErrors.has(result.error) ? result.error : "generic");
      window.location.assign(result.data.checkoutUrl);
    });
  };

  return (
    <>
      {notice && (
        <p role="status" className="mt-6 border-l border-accent pl-5 text-sm text-fg-muted">
          {notice === "free" ? t("freeLeft", { count: freeLeft, price }) : t("paid", { price })}
        </p>
      )}
      <ChatRoom
        conversationId={conversationId}
        memberId={memberId}
        initial={initial}
        closed={false}
        send={send}
        names={names}
        onSendError={(error, body) => {
          if (error !== "payment_required") return false;
          setFreeLeft(0);
          setToPay(body);
          return true;
        }}
      />
      {toPay && (
        <div role="alertdialog" aria-labelledby="message-payant" className="mt-6 border border-accent bg-bg-soft p-6">
          <p id="message-payant">{t("payPrompt", { price })}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button disabled={paying} onClick={pay}>
              {t("payAndSend", { price })}
            </Button>
            <Button variant="secondary" disabled={paying} onClick={() => setToPay(null)}>
              {t("payCancel")}
            </Button>
          </div>
          <ErrorLine error={payError} />
        </div>
      )}
      <div className="mt-10 border-t border-line pt-6">
        <p className="max-w-measure text-sm text-fg-muted">{t("closeHelp")}</p>
        <Button variant="secondary" className="mt-4" disabled={close.pending} onClick={() => close.run(() => closeCounsel(requestId))}>
          {t("close")}
        </Button>
        <ErrorLine error={close.error} />
      </div>
    </>
  );
}
