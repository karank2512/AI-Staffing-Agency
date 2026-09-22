import { defineTool, plural, quote } from "../define";

const CHANNEL_LABEL = { email: "email", slack: "Slack" } as const;

const APPROVAL_PREVIEW_CHARS = 280;

export const sendNotificationTool = defineTool("send_notification", {
  displayName: "Notifications",
  description:
    "Send a message to people by email or Slack. Provide the channel, the recipients (email addresses or Slack channel/user names), a short subject and the full body. Sending requires human approval, so call it once with the complete message.",
  humanDescription: "Sends the finished work to stakeholders by email or Slack. Every send is approved by a human first.",
  category: "communication",
  sideEffect: "external_write",
  defaultRequiresApproval: true,
  costPerCallUsd: 0.002,
  humanize: (input) =>
    `Sent ${quote(input.subject)} to ${plural(input.recipients.length, "recipient")} via ${CHANNEL_LABEL[input.channel]}`,
  describeForApproval: (input) => ({
    title: `Send ${quote(input.subject)} to ${plural(input.recipients.length, "recipient")} by ${CHANNEL_LABEL[input.channel]}`,
    description: input.body.length > APPROVAL_PREVIEW_CHARS ? `${input.body.slice(0, APPROVAL_PREVIEW_CHARS).trimEnd()}…` : input.body,
  }),
  async execute(input) {
    // Phase 1: no mail/Slack connectors exist yet. The approval + activity trail is real; delivery lands in a
    // simulated outbox, and the output says so explicitly so the UI can badge it.
    return {
      output: { delivered: true, simulated: true, channel: input.channel, recipients: input.recipients.length },
      simulated: true,
    };
  },
});
