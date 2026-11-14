// apps/api/src/modules/chat/chat.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity.js';
import { Message } from './entities/message.entity.js';
import { AiService } from './ai.service.js';
import { LeadOrchestratorService } from '../orchestrator/lead-orchestrator.service.js';
import { randomUUID } from 'crypto';

@Injectable()
export class ChatService {
  private DEFAULT_TENANT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  constructor(
    @InjectRepository(Conversation)
    private conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private messageRepo: Repository<Message>,
    private aiService: AiService,
    private leadOrchestratorService: LeadOrchestratorService,
  ) {}

  async createSession(userId: string, vertical: string, tenantId?: string) {
    const activeTenantId = tenantId || this.DEFAULT_TENANT_ID;
    const conversation = this.conversationRepo.create({
      tenantId: activeTenantId,
      visitorSessionToken: `session-${randomUUID()}`,
      status: 'active',
      vertical: vertical || 'General Service',
    } as any);
    
    const savedConversation = await this.conversationRepo.save(conversation);

    return {
      sessionId: (savedConversation as any).id,
      status: 'started',
    };
  }

  async processMessage(userId: string, conversationId: any, userMessage: string, vertical: string, tenantId?: string) {
    let conversation: any = null;
    const activeTenantId = tenantId || this.DEFAULT_TENANT_ID;
    
    if (conversationId) {
      conversation = await this.conversationRepo.findOne({ where: { id: conversationId } as any });
    }

    if (!conversation) {
      conversation = this.conversationRepo.create({
        tenantId: activeTenantId,
        visitorSessionToken: `session-${randomUUID()}`,
        status: 'active',
        vertical: vertical || 'General Service',
      } as any);
      await this.conversationRepo.save(conversation);
    }

    const convId = conversation.id;

    // Prevent duplicate user message logging
    const lastMessage = await this.messageRepo.findOne({
      where: { conversationId: convId, role: 'user', content: userMessage } as any,
      order: { createdAt: 'DESC' } as any,
    });

    if (!lastMessage) {
      const savedUserMsg = this.messageRepo.create({
        conversationId: convId,
        role: 'user',
        content: userMessage,
      } as any);
      await this.messageRepo.save(savedUserMsg);
    }

    let replyText = '';
    let metadata: any = {};
    let triggeredOrchestration = false;

    // Trigger vendor matching for any valid service inquiry across all verticals
    const isServiceInquiry = userMessage.length > 3;

    if (isServiceInquiry) {
      try {
        const orchestrationResult = await this.leadOrchestratorService.processQualifiedLead({
          tenantId: activeTenantId,
          leadId: String(convId),
          serviceVertical: vertical || conversation.vertical,
          userLocation: 'Kondapur',
          serviceScale: 1, 
          appointmentTime: new Date(Date.now() + 86400000),
        });

        if (orchestrationResult && orchestrationResult.success) {
          triggeredOrchestration = true;
          replyText = `Perfect! We have successfully matched you with our verified partner **${orchestrationResult.matchedVendor?.name || 'Verified Professional'}**.\n\n` +
                      `• **Estimated Quote:** ₹${orchestrationResult.pricingQuote?.estimatedTotal || '1,500'}\n` +
                      `• **Appointment Slot:** Tomorrow at 10:00 AM\n\n` +
                      `Please click below to secure your booking via our safe escrow payment gateway:`;
          
          metadata = {
            paymentUrl: orchestrationResult.paymentCheckout?.gatewayUrl || 'https://checkout.stripe.com/mock',
            appointmentId: orchestrationResult.appointmentDetails?.id,
            quote: orchestrationResult.pricingQuote,
          };
        }
      } catch (err) {
        console.error('Orchestration execution error:', err);
      }
    }

    if (!triggeredOrchestration) {
      const aiResult = await this.aiService.generateChatResponse([{ role: 'user', content: userMessage }]);
      replyText = aiResult.reply;
    }

    // Prevent duplicate assistant replies
    const recentAssistantMsg = await this.messageRepo.findOne({
      where: { conversationId: convId, role: 'assistant' } as any,
      order: { createdAt: 'DESC' } as any,
    });

    if (!recentAssistantMsg || recentAssistantMsg.content !== replyText) {
      const savedAssistantMsg = this.messageRepo.create({
        conversationId: convId,
        role: 'assistant',
        content: replyText,
      } as any);
      await this.messageRepo.save(savedAssistantMsg);
    }

    return {
      reply: replyText,
      conversationId: convId,
      metadata,
    };
  }
}