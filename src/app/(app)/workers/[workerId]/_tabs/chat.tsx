import { notFound } from "next/navigation";
import { isAppError } from "@/server/errors";
import { getWorkerChat, type WorkerChatView } from "@/server/queries/worker-manage";
import { ChatPanel } from "./chat-panel";
import type { WorkerTabProps } from "./types";

/**
 * "Talk to worker" — the conversation with this worker. Questions are answered from its own record, one-off
 * instructions are parked for the next run, and lasting changes become a proposed version to review.
 */
export default async function ChatTab({ session, workerId }: WorkerTabProps) {
  let data: WorkerChatView;
  try {
    data = await getWorkerChat(session.organizationId, workerId);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  return <ChatPanel worker={data.worker} messages={data.messages} pendingInstructions={data.pendingInstructions} />;
}
