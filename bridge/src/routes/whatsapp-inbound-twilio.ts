import type { FastifyInstance } from "fastify";
import { handleIncomingMessage } from "../conversation/flow.ts";
import { env } from "../config.ts";
import { isValidTwilioSignature } from "../whatsapp-client.ts";

interface TwilioInboundBody {
  From?: string;
  Body?: string;
  MessageSid?: string;
}

export function registerWhatsappTwilioInboundRoute(app: FastifyInstance): void {
  app.post<{ Body: TwilioInboundBody }>("/webhooks/whatsapp/twilio-inbound", async (request, reply) => {
    const signature = request.headers["x-twilio-signature"];
    const url = `${env.PUBLIC_WEBHOOK_BASE_URL}/webhooks/whatsapp/twilio-inbound`;

    if (
      typeof signature !== "string" ||
      !isValidTwilioSignature({ signature, url, body: request.body as Record<string, unknown> })
    ) {
      reply.code(403).send("invalid signature");
      return;
    }

    const { From, Body, MessageSid } = request.body;
    if (!From || !MessageSid) {
      reply.code(400).send("missing fields");
      return;
    }

    await handleIncomingMessage({
      phone: From.replace(/^whatsapp:/, ""),
      body: Body ?? "",
      messageId: MessageSid,
    });

    reply.type("text/xml").send("<Response></Response>");
  });
}
