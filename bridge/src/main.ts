import "dotenv/config";
import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { env } from "./config.ts";
import { registerWhatsappInboundRoute } from "./routes/whatsapp-inbound.ts";
import { registerWhatsappTwilioInboundRoute } from "./routes/whatsapp-inbound-twilio.ts";
import { registerKaneoWebhookRoute } from "./routes/kaneo-webhook.ts";

async function main() {
  const app = Fastify({ logger: true });

  // Precisa do corpo bruto (antes do parse) para verificar o HMAC do
  // X-Kaneo-Signature (routes/kaneo-webhook.ts) e do X-Hub-Signature-256
  // (routes/whatsapp-inbound.ts).
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      const buffer = body as Buffer;
      request.rawBody = buffer;
      if (buffer.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(buffer.toString("utf8")));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.get("/health", async () => ({ status: "ok" }));

  if (env.WHATSAPP_PROVIDER === "twilio") {
    await app.register(formbody);
    registerWhatsappTwilioInboundRoute(app);
  } else {
    registerWhatsappInboundRoute(app);
  }

  registerKaneoWebhookRoute(app);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
