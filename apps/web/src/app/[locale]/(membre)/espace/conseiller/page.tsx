import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ChatMessage } from "@/components/member/ChatRoom";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { CounselRow } from "./counsel";
import { CounselChat, CounselRequest } from "./CounselChat";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.counsel");
  return { title: t("title") };
}

/**
 * Conseiller sollicité seul (demande du 10 novembre 2026) : tout membre vérifié, en couple ou
 * non, sans l'accord de personne. Discussion privée (un partenaire n'en sait rien), conseiller
 * attribué par l'équipe, premiers messages gratuits puis chaque message payant.
 */
export default async function CounselPage() {
  const t = await getTranslations("Member.counsel");
  const format = await getFormatter();
  const member = await getSessionMember();
  const supabase = await createSupabaseServer();
  if (!member || !supabase) return null;

  const [{ data: rows, error }, { data: profile }, { data: pricing }] = await Promise.all([
    supabase.rpc("my_counsel"),
    supabase.from("member_profiles").select("status").eq("user_id", member.id).maybeSingle(),
    supabase.rpc("counsel_pricing"),
  ]);
  const counsel = ((rows ?? []) as CounselRow[])[0] ?? null;
  const verified = (profile as { status?: string } | null)?.status === "verified";
  const rule = ((pricing ?? []) as { price_xof: number; free_messages: number }[])[0];
  const conversationId = counsel?.status === "granted" ? counsel.conversation_id : null;
  const { data: messages } = conversationId
    ? await supabase.from("messages").select("id, sender_id, body, created_at, is_system").eq("conversation_id", conversationId).order("created_at").limit(500)
    : { data: [] as ChatMessage[] };
  if (conversationId) await supabase.rpc("mark_conversation_read", { p_conversation: conversationId });

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <p className="eyebrow flex items-center gap-4">
          <span aria-hidden="true" className="block h-px w-10 bg-accent" />
          {t("eyebrow")}
        </p>
        <h1 className="mt-6 text-4xl">{counsel?.status === "granted" && counsel.counselor_name ? counsel.counselor_name : t("title")}</h1>
        <p className="mt-6 max-w-measure text-lg text-fg-muted">{t("intro")}</p>
        {rule && rule.price_xof > 0 && (
          <p className="mt-3 max-w-measure text-sm text-fg-muted">
            {t("pricing", {
              free: rule.free_messages,
              price: format.number(rule.price_xof, { style: "currency", currency: "XOF", maximumFractionDigits: 0 }),
            })}
          </p>
        )}
      </header>

      {error ? (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      ) : !counsel ? (
        verified ? (
          <CounselRequest requestId={null} />
        ) : (
          <p role="status" className="mt-10 border-l border-accent pl-5 text-fg-muted">
            {t("notVerified")}
          </p>
        )
      ) : counsel.status === "requested" ? (
        <>
          <p role="status" className="mt-10 border-l border-accent pl-5">
            {t("waiting", { date: format.dateTime(new Date(counsel.created_at), { dateStyle: "long" }) })}
          </p>
          <CounselRequest requestId={counsel.request_id} />
        </>
      ) : conversationId ? (
        <CounselChat
          requestId={counsel.request_id}
          conversationId={conversationId}
          memberId={member.id}
          initial={(messages ?? []) as ChatMessage[]}
          names={{ [member.id]: member.firstName ?? t("me") }}
          priceXof={counsel.price_xof}
          freeLeft={counsel.free_left}
        />
      ) : (
        <p role="alert" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("errors.unavailable")}
        </p>
      )}
    </div>
  );
}
