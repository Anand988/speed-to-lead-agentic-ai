// apps/api/src/modules/chat/chat.controller.ts
import { Controller, Post, Get, Param, Body, Req } from '@nestjs/common';
import { ChatService } from './chat.service.js';

@Controller('api/v1/consumer/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('start')
  async startSession(
    @Body() body: { verticalSlug?: string; tenantId?: string; initialMessage?: string },
    @Req() req: any,
  ) {
    const userId = req.user?.id || 'anonymous-user';
    const vertical = body.verticalSlug || 'Solar Panel Installation';
    const tenantId = body.tenantId;
    const initialMessage = body.initialMessage;

    return await this.chatService.createSession(userId, vertical, tenantId, initialMessage);
  }

  @Post('message')
  async handleMessage(
    @Body() body: { sessionId?: string; message: string; verticalSlug?: string; tenantId?: string },
    @Req() req: any,
  ) {
    const userMessage = body.message;
    const conversationId = body.sessionId;

    if (!conversationId) {
      throw new Error('sessionId is required to process messages.');
    }

    // Pass the correct 2 parameters matching the service method signature
    return await this.chatService.processMessage(conversationId, userMessage);
  }

  @Get('history/:sessionId')
  async getHistory(@Param('sessionId') sessionId: string) {
    return await this.chatService.getSessionHistory(sessionId);
  }
}