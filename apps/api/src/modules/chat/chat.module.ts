// apps/api/src/modules/chat/chat.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { Conversation } from './entities/conversation.entity.js';
import { Message } from './entities/message.entity.js';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';
import { AiService } from './ai.service.js';
import { LeadOrchestratorModule } from '../orchestrator/lead-orchstrator.module.js'; // 👉 Import LeadOrchestratorModule

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message]),
    ConfigModule,
    BullModule.registerQueue({
      name: 'lead-processing',
    }),
    LeadOrchestratorModule, // 👉 Add this here so ChatController can inject LeadOrchestratorService
  ],
  controllers: [ChatController],
  providers: [ChatService, AiService],
  exports: [ChatService, AiService],
})
export class ChatModule {}