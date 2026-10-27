import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { type ChatMessage, ChatRoom } from "@/components/member/ChatRoom";
import { Link } from "@/i18n/navigation";
import { getSessionMember } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { sendMessage } from "../../matchs/actions";
import type { CoupleRow } from "../couple";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Member.couple.privateChannel");
  return { title: t("title") };
}

/**
 * Canal privé avec le conseiller du couple (question 9) : seulement avec le conseiller attribué,
 * tant que son accès est en cours ; l'autre membre ne le lit jamais. Ouvert (ou retrouvé) à
 * l'affichage par app.open_private_channel, qui revérifie tout.
 */
export default async function PrivateChannelPage() {
  const t = await getTranslations("Member");
  const member = await getSessionMember();
  const supabase = await createSupabaseServer();
  if (!member || !supabase) return null;

  const { data: rows } = await supabase.rpc("my_couple");
  const couple = ((rows ?? []) as CoupleRow[])[0];
  const opened = couple ? await supabase.rpc("open_private_channel", { p_couple: couple.couple_id }) : null;
  const conversationId = typeof opened?.data === "string" ? opened.data : null;
  const { data: messages } = conversationId
    ? await supabase.from("messages").select("id, sender_id, body, created_at, is_system").eq("conversation_id", conversationId).order("created_at").limit(500)
    : { data: [] as ChatMessage[] };
  if (conversationId) await supabase.rpc("mark_conversation_read", { p_conversation: conversationId });
  const counselor = couple?.counselor_name ?? t("chat.counselor");

  return (
    <div className="mx-auto max-w-4xl">
      <p>
        <Link href="/espace/couple" className="text-sm text-link underline-offset-4 hover:underline">
          {t("couple.privateChannel.back")}
        </Link>
      </p>
      <header className="mt-6">
        <p className="eyebrow">{t("couple.privateChannel.title")}</p>
        <h1 className="mt-4 font-serif text-4xl">{counselor}</h1>
        <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("couple.privateChannel.help")}</p>
      </header>
      {conversationId ? (
        <ChatRoom
          conversationId={conversationId}
          memberId={member.id}
          initial={(messages ?? []) as ChatMessage[]}
          closed={false}
          send={sendMessage}
          names={{ [member.id]: member.firstName ?? t("chat.me") }}
        />
      ) : (
        <p role="status" className="mt-10 border-l border-accent pl-5 text-fg-muted">
          {t("couple.privateChannel.unavailable")}
        </p>
      )}
    </div>
  );
}
