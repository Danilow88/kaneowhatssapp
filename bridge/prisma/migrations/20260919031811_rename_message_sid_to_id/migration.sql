/*
  Warnings:

  - You are about to drop the column `lastProcessedMessageSid` on the `ConversationState` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ConversationState" DROP COLUMN "lastProcessedMessageSid",
ADD COLUMN     "lastProcessedMessageId" TEXT;
