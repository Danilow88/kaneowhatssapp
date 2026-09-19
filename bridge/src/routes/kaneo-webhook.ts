import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { env } from "../config.ts";
import { CUSTOMER_RELAY_PREFIX } from "../conversation/flow.ts";
import * as store from "../conversation/state-store.ts";
import { sendWhatsappText } from "../whatsapp-client.ts";

interface KaneoWebhookPayload {
  event: string;
  task: { id: string };
  actor: { id: string | null; name: string | null };
  data: Record<string, unknown>;
}

function isValidSignature(rawBody: Buffer, signature: string): boolean {
  const expected = createHmac("sha256", env.KANEO_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function registerKaneoWebhookRoute(app: FastifyInstance): void {
  app.post<{ Body: KaneoWebhookPayload }>("/webhooks/kaneo", async (request, reply) => {
    const signature = request.headers["x-kaneo-signature"];
    if (
      typeof signature !== "string" ||
      !request.rawBody ||
      !isValidSignature(request.rawBody, signature)
    ) {
      reply.code(403).send("invalid signature");
      return;
    }

    const { event, task, data } = request.body;

    const link = await store.findTicketLinkByTaskId(task.id);
    if (!link) {
      reply.code(200).send();
      return;
    }

    if (
      event === "task.comment_created" &&
      typeof data.comment === "string" &&
      !data.comment.startsWith(CUSTOMER_RELAY_PREFIX)
    ) {
      await sendWhatsappText(link.phone, data.comment);
    }

    if (event === "task.status_changed" && data.newStatus === "done") {
      await sendWhatsappText(
        link.phone,
        "Seu chamado foi marcado como resolvido. Se precisar de algo mais, é só chamar.",
      );
    }

    reply.code(200).send();
  });
}
