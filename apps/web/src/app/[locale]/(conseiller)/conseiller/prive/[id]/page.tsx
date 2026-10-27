import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { type ChatMessage, ChatRoom } from "@/components/member/ChatRoom";
import { Link } from "@/i18n/navigation";
import { getCounselor } from "@/lib/counselor";
import { createSupabaseServer } from "@/lib/supabase/server";
import { counselorSend } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Counselor.private");
  return { title: t("title") };
}

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canal privé avec un membre d'un couple suivi (question 9) : introuvable dès qu'il est fermé. */
export default async function CounselorPrivateChannelPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const counselor = await getCounselor();
  const supabase = await createSupabaseServer();
  if (!counselor || !supabase) notFound();
  const t = await getTranslations("Counselor");
  const { data: channels } = await supabase.rpc("counselor_private_channels");
  const channel = ((channels ?? []) as { conversation_id: string; member_first_name: string }[]).find((c) => c.conversation_id === id);
  if (!channel) notFound();
  const { data: messages } = await supabase.from("messages").select("id, sender_id, body, created_at, is_system").eq("conversation_id", id).order("created_at").limit(500);
  await supabase.rpc("mark_conversation_read", { p_conversation: id });

  return (
    <div className="mx-auto max-w-4xl">
      <p>
        <Link href="/conseiller" className="text-sm text-link underline-offset-4 hover:underline">
          {t("couples.back")}
        </Link>
      </p>
      <header className="mt-6">
        <p className="eyebrow">{t("private.title")}</p>
        <h1 className="mt-4 font-serif text-4xl">{channel.member_first_name}</h1>
        <p className="mt-3 max-w-measure text-sm text-fg-muted">{t("private.help")}</p>
      </header>
      <ChatRoom
        conversationId={id}
        memberId={counselor.id}
        initial={(messages ?? []) as ChatMessage[]}
        closed={false}
        send={counselorSend}
        names={{ [counselor.id]: counselor.displayName }}
      />
    </div>
  );
}
