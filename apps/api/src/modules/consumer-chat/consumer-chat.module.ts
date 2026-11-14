import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsumerChatController } from './consumer-chat.controller.js';
import { ConsumerChatService } from './consumer-chat.service.js';
import { VerticalPromptService } from './vertical-prompt.service.js';
import { MarketplaceMatchingProcessor } from './marketplace-matching.processor.js';
import { Lead } from '../lead/lead.entity.js';
import { Tenant } from '../tenant/tenant.entity.js';
import { Message } from '../consumer-chat/message.entity.js';
import { QueueModule } from '../queue/queue.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, Tenant, Message]),
    QueueModule,
  ],
  controllers: [ConsumerChatController],
  providers: [
    ConsumerChatService,
    VerticalPromptService,
    MarketplaceMatchingProcessor,
  ],
  exports: [ConsumerChatService],
})
export class ConsumerChatModule {}