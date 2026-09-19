import type { FastifyInstance } from "fastify";
import { handleIncomingMessage } from "../conversation/flow.ts";
import { env } from "../config.ts";
import { isValidMetaSignature } from "../whatsapp-client.ts";

interface MetaWebhookBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from: string;
          id: string;
          type: string;
          text?: { body: string };
        }>;
        statuses?: Array<{
          id: string;
          status: string;
          recipient_id: string;
        }>;
      };
    }>;
  }>;
}

interface VerificationQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

export function registerWhatsappInboundRoute(app: FastifyInstance): void {
  app.get<{ Querystring: VerificationQuery }>("/webhooks/whatsapp/inbound", async (request, reply) => {
    const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = request.query;

    if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN && challenge) {
      reply.type("text/plain").send(challenge);
      return;
    }

    reply.code(403).send();
  });

  app.post<{ Body: MetaWebhookBody }>("/webhooks/whatsapp/inbound", async (request, reply) => {
    const signature = request.headers["x-hub-signature-256"];

    if (
      typeof signature !== "string" ||
      !request.rawBody ||
      !isValidMetaSignature(request.rawBody, signature)
    ) {
      reply.code(403).send("invalid signature");
      return;
    }

    for (const entry of request.body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          if (message.type !== "text") continue;

          await handleIncomingMessage({
            phone: `+${message.from}`,
            body: message.text?.body ?? "",
            messageId: message.id,
          });
        }

        for (const status of change.value?.statuses ?? []) {
          if (status.status === "failed") {
            request.log.error(
              { messageId: status.id, recipient: status.recipient_id },
              "Falha na entrega de mensagem WhatsApp",
            );
          }
        }
      }
    }

    reply.code(200).send();
  });
}
