// apps/api/src/modules/chat/chat.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { Lead } from '../lead/lead.entity.js';
import { Message } from '../consumer-chat/message.entity.js';
import { VerticalEntity } from '../tenant/domain.entity.js';
import { QueueModule } from '../queue/queue.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, Message, VerticalEntity]),
    QueueModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}