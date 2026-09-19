import { PrismaClient, type ConversationStep, type Prisma } from "@prisma/client";

export const prisma = new PrismaClient();

export async function getConversationState(phone: string) {
  return prisma.conversationState.findUnique({ where: { phone } });
}

export async function setConversationState(
  phone: string,
  step: ConversationStep,
  data: Prisma.InputJsonValue,
) {
  await prisma.conversationState.upsert({
    where: { phone },
    create: { phone, step, data },
    update: { step, data },
  });
}

export async function clearConversationState(phone: string) {
  await prisma.conversationState.upsert({
    where: { phone },
    create: { phone, step: null, data: {} },
    update: { step: null, data: {} },
  });
}

export async function isDuplicateMessage(phone: string, messageId: string): Promise<boolean> {
  const state = await prisma.conversationState.findUnique({ where: { phone } });
  return state?.lastProcessedMessageId === messageId;
}

export async function markMessageProcessed(phone: string, messageId: string) {
  await prisma.conversationState.upsert({
    where: { phone },
    create: { phone, lastProcessedMessageId: messageId, data: {} },
    update: { lastProcessedMessageId: messageId },
  });
}

export async function createTicketLink(params: {
  phone: string;
  kaneoTaskId: string;
  kaneoTaskNumber: number;
  customerType: string;
}) {
  return prisma.ticketLink.create({ data: params });
}

export async function findLatestTicketLink(phone: string) {
  return prisma.ticketLink.findFirst({
    where: { phone },
    orderBy: { createdAt: "desc" },
  });
}

export async function findTicketLinkByPhoneAndNumber(phone: string, kaneoTaskNumber: number) {
  return prisma.ticketLink.findFirst({ where: { phone, kaneoTaskNumber } });
}

export async function findTicketLinkByTaskId(kaneoTaskId: string) {
  return prisma.ticketLink.findUnique({ where: { kaneoTaskId } });
}
