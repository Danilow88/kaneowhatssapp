import type { ConversationStep } from "@prisma/client";
import * as kaneo from "../kaneo-client.ts";
import { sendWhatsappText } from "../whatsapp-client.ts";
import * as store from "./state-store.ts";

export const CUSTOMER_RELAY_PREFIX = "📱 Cliente via WhatsApp: ";

interface TicketDraft {
  name?: string;
  email?: string;
  customerType?: string;
  category?: string;
  description?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CUSTOMER_TYPE_OPTIONS: Record<string, string> = {
  "1": "Interno",
  "2": "Externo",
};

const CATEGORY_OPTIONS: Record<string, string> = {
  "1": "Técnico",
  "2": "Financeiro",
  "3": "Acesso",
  "4": "Outro",
};

const STATUS_LABELS: Record<string, string> = {
  "to-do": "Novo",
  "in-progress": "Em atendimento",
  "in-review": "Aguardando cliente",
  done: "Resolvido",
};

const MAIN_MENU_TEXT =
  "Olá! Como posso ajudar?\n\n1 - Abrir novo chamado\n2 - Consultar status de um chamado";

const NAME_QUESTION = "Qual seu nome completo?";

const EMAIL_QUESTION = "Qual seu e-mail para contato?";

const CUSTOMER_TYPE_QUESTION = "Você é cliente Interno ou Externo?\n1 - Interno\n2 - Externo";

const CATEGORY_QUESTION =
  "Qual a categoria do chamado?\n1 - Técnico\n2 - Financeiro\n3 - Acesso\n4 - Outro";

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export async function handleIncomingMessage(params: {
  phone: string;
  body: string;
  messageId: string;
}): Promise<void> {
  const { phone, body, messageId } = params;

  if (await store.isDuplicateMessage(phone, messageId)) {
    return;
  }

  await routeMessage(phone, body.trim());
  await store.markMessageProcessed(phone, messageId);
}

async function routeMessage(phone: string, text: string): Promise<void> {
  const state = await store.getConversationState(phone);

  if (state?.step) {
    await handleStep(phone, state.step, (state.data as TicketDraft) ?? {}, text);
    return;
  }

  const statusMatch = normalize(text).match(/^status\s+(\d+)/);
  if (statusMatch) {
    await handleStatusQuery(phone, Number(statusMatch[1]));
    return;
  }

  const openTicket = await findOpenTicket(phone);
  if (openTicket) {
    await handleFollowUp(phone, openTicket, text);
    return;
  }

  if (normalize(text) === "1") {
    await store.setConversationState(phone, "NEW_TICKET_NAME", {});
    await sendWhatsappText(phone, NAME_QUESTION);
    return;
  }

  if (normalize(text) === "2") {
    await sendWhatsappText(phone, "Envie: status <número do chamado>. Exemplo: status 42");
    return;
  }

  await sendWhatsappText(phone, MAIN_MENU_TEXT);
}

async function handleStep(
  phone: string,
  step: ConversationStep,
  data: TicketDraft,
  text: string,
): Promise<void> {
  const choice = normalize(text);

  switch (step) {
    case "NEW_TICKET_NAME": {
      if (!text.trim()) {
        await sendWhatsappText(phone, "Pode informar seu nome completo?");
        return;
      }
      await store.setConversationState(phone, "NEW_TICKET_EMAIL", { ...data, name: text.trim() });
      await sendWhatsappText(phone, EMAIL_QUESTION);
      return;
    }

    case "NEW_TICKET_EMAIL": {
      const email = text.trim();
      if (!EMAIL_REGEX.test(email)) {
        await sendWhatsappText(phone, "Não parece um e-mail válido. Envie novamente, ex: nome@example.com");
        return;
      }
      await store.setConversationState(phone, "NEW_TICKET_CUSTOMER_TYPE", { ...data, email });
      await sendWhatsappText(phone, CUSTOMER_TYPE_QUESTION);
      return;
    }

    case "NEW_TICKET_CUSTOMER_TYPE": {
      const customerType = CUSTOMER_TYPE_OPTIONS[choice];
      if (!customerType) {
        await sendWhatsappText(phone, "Não entendi. Responda 1 para Interno ou 2 para Externo.");
        return;
      }
      await store.setConversationState(phone, "NEW_TICKET_CATEGORY", { ...data, customerType });
      await sendWhatsappText(phone, CATEGORY_QUESTION);
      return;
    }

    case "NEW_TICKET_CATEGORY": {
      const category = CATEGORY_OPTIONS[choice];
      if (!category) {
        await sendWhatsappText(phone, "Não entendi. Responda com um número de 1 a 4.");
        return;
      }
      await store.setConversationState(phone, "NEW_TICKET_DESCRIPTION", { ...data, category });
      await sendWhatsappText(phone, "Descreva o problema em poucas palavras.");
      return;
    }

    case "NEW_TICKET_DESCRIPTION": {
      if (!text.trim()) {
        await sendWhatsappText(phone, "Pode descrever o problema em texto?");
        return;
      }
      const updated = { ...data, description: text.trim() };
      await store.setConversationState(phone, "NEW_TICKET_CONFIRM", updated);
      await sendWhatsappText(
        phone,
        `Confirma a abertura do chamado?\n\nNome: ${updated.name}\nEmail: ${updated.email}\nTipo: ${updated.customerType}\nCategoria: ${updated.category}\nDescrição: ${updated.description}\n\n1 - Confirmar\n2 - Recomeçar`,
      );
      return;
    }

    case "NEW_TICKET_CONFIRM": {
      if (choice === "2") {
        await store.setConversationState(phone, "NEW_TICKET_NAME", {});
        await sendWhatsappText(phone, `Sem problemas, vamos recomeçar.\n\n${NAME_QUESTION}`);
        return;
      }
      if (choice !== "1") {
        await sendWhatsappText(phone, "Responda 1 para confirmar ou 2 para recomeçar.");
        return;
      }

      const task = await kaneo.createTicketTask({
        title: `[${data.customerType}/${data.category}] Chamado via WhatsApp`,
        description: data.description ?? "",
        phone,
        customerType: data.customerType ?? "",
        name: data.name ?? "",
        email: data.email ?? "",
      });

      await store.createTicketLink({
        phone,
        kaneoTaskId: task.id,
        kaneoTaskNumber: task.number ?? 0,
        customerType: data.customerType ?? "",
      });

      await store.clearConversationState(phone);
      await sendWhatsappText(
        phone,
        `Chamado aberto! Seu protocolo é #${task.number}. Um atendente vai te responder por aqui.`,
      );
      return;
    }

    default:
      await store.clearConversationState(phone);
      await sendWhatsappText(phone, MAIN_MENU_TEXT);
  }
}

async function handleStatusQuery(phone: string, ticketNumber: number): Promise<void> {
  const link = await store.findTicketLinkByPhoneAndNumber(phone, ticketNumber);
  if (!link) {
    await sendWhatsappText(
      phone,
      `Não encontramos nenhum chamado #${ticketNumber} associado a este telefone.`,
    );
    return;
  }

  const task = await kaneo.getTask(link.kaneoTaskId);
  await sendWhatsappText(
    phone,
    `Chamado #${ticketNumber}\nStatus: ${STATUS_LABELS[task.status] ?? task.status}\nAberto em: ${link.createdAt.toLocaleDateString("pt-BR")}`,
  );
}

async function findOpenTicket(
  phone: string,
): Promise<{ kaneoTaskId: string; status: string } | null> {
  const latest = await store.findLatestTicketLink(phone);
  if (!latest) return null;

  const task = await kaneo.getTask(latest.kaneoTaskId);
  if (task.status === "done") return null;

  return { kaneoTaskId: latest.kaneoTaskId, status: task.status };
}

async function handleFollowUp(
  phone: string,
  openTicket: { kaneoTaskId: string; status: string },
  text: string,
): Promise<void> {
  await kaneo.addComment(openTicket.kaneoTaskId, `${CUSTOMER_RELAY_PREFIX}${text}`);

  if (openTicket.status === "in-review") {
    await kaneo.setTaskStatus(openTicket.kaneoTaskId, "in-progress");
  }

  await sendWhatsappText(phone, "Recebemos sua mensagem. Um atendente vai responder em breve.");
}
