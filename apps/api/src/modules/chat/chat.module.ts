// apps/api/src/modules/chat/chat.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { DeepSeekExtractorService } from './deepseek-extractor.service.js';
import { VerticalPromptService } from '../consumer-chat/vertical-prompt.service.js';
import { Lead } from '../lead/lead.entity.js';
import { Message } from '../consumer-chat/message.entity.js';
import { VerticalEntity } from '../tenant/entities/vertical.entity.js';
import { BusinessEntity } from '../tenant/entities/business.entity.js';
import { ServiceEntity } from '../tenant/entities/service.entity.js';
import { QueueModule } from '../queue/queue.module.js';
import { ChatCacheService } from './chat-cache.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, Message, VerticalEntity, BusinessEntity, ServiceEntity]),
    QueueModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    DeepSeekExtractorService,
    VerticalPromptService,
    ChatCacheService,
  ],
  exports: [ChatService, DeepSeekExtractorService, VerticalPromptService, ChatCacheService],
})
export class ChatModule {}