// apps/api/src/modules/consumer-chat/consumer-chat.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueService } from '../queue/queue.service.js';
import { Lead, LeadStatus } from '../lead/lead.entity.js';
import { Message } from './message.entity.js';
import { VerticalEntity } from '../tenant/entities/domain.entity.js';

@Injectable()
export class ConsumerChatService {
  private readonly logger = new Logger(ConsumerChatService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly queueService: QueueService,
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(VerticalEntity)
    private readonly verticalRepository: Repository<VerticalEntity>,
  ) {}

  async startSession(verticalSlug: string, initialMessage?: string) {
    const sessionId = `visitor_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    await this.messageRepository.save({
      sessionId,
      sender: 'system',
      content: `Session started for vertical: ${verticalSlug}`,
    });

    const vertical = await this.verticalRepository.findOne({ where: { slug: verticalSlug } });
    const verticalName = vertical?.name || verticalSlug.replace(/-/g, ' ');
    
    // Unified intake steps for ALL verticals (including solar)
    const intakeSteps = vertical?.intakeSteps || [
      { stepIndex: 1, question: `What property type needs ${verticalName} service?`, quickReplies: ['Residential', 'Commercial', 'Industrial'] },
      { stepIndex: 2, question: "When would you like this scheduled?", quickReplies: ['This Weekend', 'Weekday', 'As Soon As Possible'] },
      { stepIndex: 3, question: "Please share your full name and phone number:", quickReplies: [] }
    ];

    const intro = initialMessage 
      ? `I see you are inquiring about: "${initialMessage}".` 
      : `Let's get your project configured.`;

    const initialGreeting = `Hello! I'm your assistant for ${verticalName}. ${intro} ${intakeSteps[0].question}`;

    const initialLead = this.leadRepository.create({
      sessionId,
      verticalSlug,
      status: LeadStatus.NEW,
      source: 'Public Discovery Marketplace',
      firstName: 'Pending',
      lastName: '',
      phone: '',
      metadata: { stepIndex: 1, extractedData: { initialRequirement: initialMessage } },
    });
    await this.leadRepository.save(initialLead);

    await this.messageRepository.save({
      sessionId,
      sender: 'assistant',
      content: initialGreeting,
      extractedData: { stepIndex: 1 },
    });

    return {
      sessionId,
      verticalSlug,
      initialMessage: initialGreeting,
      metadata: {
        stepIndex: 1,
        quickReplies: intakeSteps[0].quickReplies,
      },
    };
  }

  async processMessage(sessionId: string, verticalSlug: string, userMessage: string) {
    this.screenMessageForThreats(userMessage);

    await this.messageRepository.save({
      sessionId,
      sender: 'visitor',
      content: userMessage,
    });

    let lead = await this.leadRepository.findOne({ where: { sessionId } });
    if (!lead) {
      lead = this.leadRepository.create({
        sessionId,
        verticalSlug,
        status: LeadStatus.NEW,
        source: 'Public Discovery Marketplace',
        firstName: 'Pending',
        lastName: '',
        phone: '',
        metadata: { stepIndex: 1, extractedData: {} },
      });
    }

    const metadata = lead.metadata || {};
    let currentStepIndex = metadata.stepIndex || 1;
    let extractedData = metadata.extractedData || {};

    // --- MEMORY PERSISTENCE: ATOMIC CAPTURE OF CONTACT INFO ---
    const phoneMatch = userMessage.match(/(\+91[\-\s]?)?[6-9]\d{9}/);
    if (phoneMatch) {
      extractedData.phone = phoneMatch[0];
    }
    
    // Capture name if provided or if we are at step 3
    if (currentStepIndex === 3 && !extractedData.name && !phoneMatch) {
      extractedData.name = userMessage.trim();
    } else if (userMessage.toLowerCase().includes('name is')) {
      const parts = userMessage.split(/is/i);
      if (parts[1]) extractedData.name = parts[1].trim();
    }

    const vertical = await this.verticalRepository.findOne({ where: { slug: verticalSlug } });
    const verticalName = vertical?.name || verticalSlug.replace(/-/g, ' ');

    const intakeSteps = vertical?.intakeSteps || [
      { stepIndex: 1, question: `What property type needs ${verticalName} service?`, quickReplies: ['Residential', 'Commercial', 'Industrial'] },
      { stepIndex: 2, question: "When would you like this scheduled?", quickReplies: ['This Weekend', 'Weekday', 'As Soon As Possible'] },
      { stepIndex: 3, question: "Please share your full name and phone number:", quickReplies: [] }
    ];

    let responseContent = '';
    let isQualified = false;
    let quickReplies: string[] = [];

    // --- DOMAIN GUARDRAIL FOR OFF-TOPIC TEXT ---
    const lowerMsg = userMessage.toLowerCase();
    const isOffTopic = lowerMsg.includes('weather') || lowerMsg.includes('joke') || lowerMsg.includes('poem') || lowerMsg.includes('what can you do');

    if (isOffTopic) {
      responseContent = `I am your specialized assistant for **${verticalName}**. Let's stay focused on your project: ${intakeSteps[currentStepIndex - 1]?.question || intakeSteps[0].question}`;
      quickReplies = intakeSteps[currentStepIndex - 1]?.quickReplies || intakeSteps[0].quickReplies;
    } else if (currentStepIndex === 1) {
      extractedData.propertyType = userMessage;
      currentStepIndex = 2;
      responseContent = `Got it (${userMessage}). ${intakeSteps[1]?.question || "When would you like this scheduled?"}`;
      quickReplies = intakeSteps[1]?.quickReplies || ['This Weekend', 'Weekday', 'As Soon As Possible'];
    } else if (currentStepIndex === 2) {
      extractedData.schedule = userMessage;
      currentStepIndex = 3;
      responseContent = `Almost done! ${intakeSteps[2]?.question || "Please share your full name and phone number:"}`;
      quickReplies = [];
    } else {
      // If we have both name & phone (or captured via message), finalize qualification
      if (extractedData.phone || phoneMatch) {
        extractedData.phone = extractedData.phone || phoneMatch?.[0];
      }
      if (!extractedData.name) {
        extractedData.name = userMessage;
      }

      lead.firstName = extractedData.name || 'Consumer';
      lead.phone = extractedData.phone || 'Pending';
      isQualified = true;
      currentStepIndex = 4;

      responseContent = `Thank you, ${lead.firstName}! We have successfully logged your request for **${verticalName}**.\n\n- Requirement: ${extractedData.initialRequirement || 'General Inquiry'}\n- Property Type: ${extractedData.propertyType || 'Standard'}\n- Schedule: ${extractedData.schedule || 'Flexible'}\n- Contact Phone: ${lead.phone}\n\nPlease click below to secure your booking via our safe escrow payment gateway:`;
      quickReplies = [];
    }

    // If contact info is already present at step 3, auto-advance to qualification
    if (currentStepIndex === 3 && extractedData.phone && extractedData.name) {
      isQualified = true;
      currentStepIndex = 4;
      responseContent = `Thank you, ${extractedData.name}! We have all your details for **${verticalName}**.\n\nPlease proceed via our secure escrow payment gateway:`;
    }

    lead.metadata = { stepIndex: currentStepIndex, extractedData };
    if (isQualified) {
      lead.status = LeadStatus.NEW;
    }
    await this.leadRepository.save(lead);

    if (isQualified) {
      await this.queueService.addMarketplaceMatchingJob({
        leadId: lead.id,
        verticalSlug,
        sessionId,
        metadata: extractedData,
      });
      this.logger.log(`Lead ${lead.id} successfully qualified and queued.`);
    }

    await this.messageRepository.save({
      sessionId,
      sender: 'assistant',
      content: responseContent,
      extractedData,
    });

    return {
      sessionId,
      reply: responseContent,
      isQualified,
      leadId: lead.id,
      extractedData,
      metadata: {
        stepIndex: currentStepIndex,
        quickReplies: isQualified ? [] : quickReplies,
        paymentUrl: isQualified ? 'https://pay.escrow.com/gateway/pay_secure_token_123' : undefined,
      },
    };
  }

  private screenMessageForThreats(message: string): void {
    const lower = message.toLowerCase();
    const maliciousPatterns = ['ignore previous instructions', 'system prompt', 'drop table', '<script>'];
    for (const pattern of maliciousPatterns) {
      if (lower.includes(pattern)) {
        throw new BadRequestException('Request flagged by security filter.');
      }
    }
  }
}