-- CreateEnum
CREATE TYPE "ConversationStep" AS ENUM ('NEW_TICKET_CUSTOMER_TYPE', 'NEW_TICKET_CATEGORY', 'NEW_TICKET_DESCRIPTION', 'NEW_TICKET_CONFIRM');

-- CreateTable
CREATE TABLE "ConversationState" (
    "phone" TEXT NOT NULL,
    "step" "ConversationStep",
    "data" JSONB NOT NULL DEFAULT '{}',
    "lastProcessedMessageSid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "TicketLink" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "kaneoTaskId" TEXT NOT NULL,
    "kaneoTaskNumber" INTEGER NOT NULL,
    "customerType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketLink_kaneoTaskId_key" ON "TicketLink"("kaneoTaskId");

-- CreateIndex
CREATE INDEX "TicketLink_phone_createdAt_idx" ON "TicketLink"("phone", "createdAt");
