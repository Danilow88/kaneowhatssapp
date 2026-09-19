import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),

  // "meta" é o alvo definitivo (Cloud API direta, sem BSP). "twilio" existe só
  // como via alternativa temporária pra destravar testes enquanto a
  // verificação de negócio da Meta não é aprovada — voltar pra "meta" depois.
  WHATSAPP_PROVIDER: z.enum(["meta", "twilio"]).default("meta"),

  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  META_WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().min(1).default("v24.0"),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().optional(),
  PUBLIC_WEBHOOK_BASE_URL: z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional()),

  KANEO_API_URL: z.string().url(),
  KANEO_API_KEY: z.string().min(1),
  KANEO_PROJECT_ID: z.string().min(1),
  KANEO_FIELD_PHONE_ID: z.string().min(1),
  KANEO_FIELD_CUSTOMER_TYPE_ID: z.string().min(1),
  KANEO_FIELD_NAME_ID: z.string().min(1),
  KANEO_FIELD_EMAIL_ID: z.string().min(1),
  KANEO_WEBHOOK_SECRET: z.string().min(1),
});

export const env = envSchema.parse(process.env);

if (env.WHATSAPP_PROVIDER === "meta") {
  if (
    !env.META_WHATSAPP_PHONE_NUMBER_ID ||
    !env.META_WHATSAPP_ACCESS_TOKEN ||
    !env.META_APP_SECRET ||
    !env.META_WEBHOOK_VERIFY_TOKEN
  ) {
    throw new Error(
      "META_WHATSAPP_PHONE_NUMBER_ID, META_WHATSAPP_ACCESS_TOKEN, META_APP_SECRET e META_WEBHOOK_VERIFY_TOKEN são obrigatórios quando WHATSAPP_PROVIDER=meta",
    );
  }
} else {
  if (
    !env.TWILIO_ACCOUNT_SID ||
    !env.TWILIO_AUTH_TOKEN ||
    !env.TWILIO_WHATSAPP_NUMBER ||
    !env.PUBLIC_WEBHOOK_BASE_URL
  ) {
    throw new Error(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER e PUBLIC_WEBHOOK_BASE_URL são obrigatórios quando WHATSAPP_PROVIDER=twilio",
    );
  }
}
