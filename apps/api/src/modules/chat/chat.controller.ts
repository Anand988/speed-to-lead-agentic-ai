// apps/api/src/modules/chat/chat.controller.ts
import { Controller, Post, Body, Req } from '@nestjs/common';
import { ChatService } from './chat.service.js';

@Controller('api/v1/consumer/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('start')
  async startSession(
    @Body() body: { verticalSlug?: string; tenantId?: string },
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'anonymous-user';
    const vertical = body.verticalSlug || 'Solar Panel Installation';
    const tenantId = body.tenantId;

    return await this.chatService.createSession(userId, vertical, tenantId);
  }

  @Post('message')
  async handleMessage(
    @Body() body: { sessionId?: string; message: string; verticalSlug?: string; tenantId?: string },
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'anonymous-user';
    const userMessage = body.message;
    const vertical = body.verticalSlug || 'Solar Panel Installation';
    const conversationId = body.sessionId || null;
    const tenantId = body.tenantId;

    return await this.chatService.processMessage(
      userId,
      conversationId,
      userMessage,
      vertical,
      tenantId,
    );
  }
}