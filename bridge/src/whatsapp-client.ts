import twilio from "twilio";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./config.ts";

const twilioClient =
  env.WHATSAPP_PROVIDER === "twilio" ? twilio(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!) : null;

export async function sendWhatsappText(toPhone: string, body: string): Promise<string> {
  if (env.WHATSAPP_PROVIDER === "twilio") {
    const message = await twilioClient!.messages.create({
      from: env.TWILIO_WHATSAPP_NUMBER!,
      to: `whatsapp:${toPhone}`,
      body,
    });
    return message.sid;
  }

  const response = await fetch(
    `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.META_WHATSAPP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone.replace(/^\+/, ""),
        type: "text",
        text: { body },
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Falha ao enviar mensagem via Meta Cloud API: ${response.status} ${errorBody}`);
  }

  const payload = (await response.json()) as { messages: { id: string }[] };
  return payload.messages[0].id;
}

export function isValidMetaSignature(rawBody: Buffer, signatureHeader: string): boolean {
  if (!signatureHeader.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", env.META_APP_SECRET!).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signatureHeader.slice("sha256=".length), "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function isValidTwilioSignature(params: {
  signature: string;
  url: string;
  body: Record<string, unknown>;
}): boolean {
  return twilio.validateRequest(env.TWILIO_AUTH_TOKEN!, params.signature, params.url, params.body);
}
