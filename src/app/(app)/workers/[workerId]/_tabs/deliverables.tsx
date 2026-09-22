import { Section } from "@/components/section";
import { listWorkerDeliverables } from "@/server/queries/worker-profile";
import { DeliverablesList } from "./deliverables-list";
import type { WorkerTabProps } from "./types";

export default async function DeliverablesTab({ session, workerId, workerName }: WorkerTabProps) {
  const deliverables = await listWorkerDeliverables(session.organizationId, workerId);
  const awaiting = deliverables.filter((d) => d.status === "PENDING_REVIEW").length;

  return (
    <Section
      title="Deliverables"
      description={
        deliverables.length === 0
          ? `Everything ${workerName} produces shows up here.`
          : awaiting > 0
            ? `${awaiting === 1 ? "One deliverable is" : `${awaiting} deliverables are`} waiting for your review. Accepting or rejecting teaches ${workerName} what good looks like.`
            : `All of ${workerName}'s work has been reviewed.`
      }
    >
      <DeliverablesList deliverables={deliverables} workerName={workerName} />
    </Section>
  );
}
