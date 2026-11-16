// apps/api/src/modules/chat/chat.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueService } from '../queue/queue.service.js';
import { Lead, LeadStatus } from '../lead/lead.entity.js';
import { Message } from '../consumer-chat/message.entity.js';
import { VerticalEntity } from '../tenant/domain.entity.js';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly queueService: QueueService,
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(VerticalEntity)
    private readonly verticalRepository: Repository<VerticalEntity>,
  ) {}

  async createSession(userId: string, verticalSlug: string, tenantId?: string, initialMessage?: string) {
    const sessionId = `visitor_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    await this.messageRepository.save({
      sessionId,
      sender: 'system',
      content: `Session started for vertical: ${verticalSlug}`,
    });

    const vertical = await this.verticalRepository.findOne({ where: { slug: verticalSlug } });
    const verticalName = vertical?.name || verticalSlug.replace(/-/g, ' ');
    
    // 4-Step Consultative Intake Flow (Property Type -> Priority/Scope -> Schedule -> Name & Phone)
    const intakeSteps = vertical?.intakeSteps || [
      { stepIndex: 1, question: `What property type needs ${verticalName} service?`, quickReplies: ['Residential', 'Commercial', 'Industrial'] },
      { stepIndex: 2, question: "What is your main priority or specific requirement for this project?", quickReplies: ['Perimeter Security', 'Surveillance & Cameras', 'Access Control', 'Full System Customization'] },
      { stepIndex: 3, question: "When would you like this scheduled for a consultation?", quickReplies: ['This Weekend', 'Weekday', 'As Soon As Possible'] },
      { stepIndex: 4, question: "Please share your full name and phone number:", quickReplies: [] }
    ];

    const cleanedInitialMsg = initialMessage && initialMessage.trim().length > 0 ? initialMessage.trim() : null;
    
    if (cleanedInitialMsg) {
      await this.messageRepository.save({
        sessionId,
        sender: 'visitor',
        content: cleanedInitialMsg,
      });
    }

    const initialGreeting = `Hello! I'm your assistant for ${verticalName}. Let's get your project configured. ${intakeSteps[0].question}`;

    const initialLead = this.leadRepository.create({
      sessionId,
      verticalSlug,
      status: LeadStatus.NEW,
      source: 'Public Discovery Marketplace',
      firstName: 'Pending',
      lastName: '',
      phone: '',
      metadata: { stepIndex: 1, extractedData: { initialRequirement: cleanedInitialMsg || 'General Inquiry' } },
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
      userInitialMessage: cleanedInitialMsg,
      metadata: {
        stepIndex: 1,
        quickReplies: intakeSteps[0].quickReplies,
      },
    };
  }

  async processMessage(userId: string, sessionId: string | null, userMessage: string, verticalSlug: string, tenantId?: string) {
    const activeSessionId = sessionId || `visitor_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    this.screenMessageForThreats(userMessage);

    await this.messageRepository.save({
      sessionId: activeSessionId,
      sender: 'visitor',
      content: userMessage,
    });

    let lead = await this.leadRepository.findOne({ where: { sessionId: activeSessionId } });
    if (!lead) {
      lead = this.leadRepository.create({
        sessionId: activeSessionId,
        verticalSlug,
        status: LeadStatus.NEW,
        source: 'Public Discovery Marketplace',
        firstName: 'Pending',
        lastName: '',
        phone: '',
        metadata: { stepIndex: 1, extractedData: { tenantId } },
      });
    }

    const metadata = lead.metadata || {};
    let currentStepIndex = metadata.stepIndex || 1;
    let extractedData = metadata.extractedData || {};

    const vertical = await this.verticalRepository.findOne({ where: { slug: verticalSlug } });
    const verticalName = vertical?.name || verticalSlug.replace(/-/g, ' ');

    const intakeSteps = vertical?.intakeSteps || [
      { stepIndex: 1, question: `What property type needs ${verticalName} service?`, quickReplies: ['Residential', 'Commercial', 'Industrial'] },
      { stepIndex: 2, question: "What is your main priority or specific requirement for this project?", quickReplies: ['Perimeter Security', 'Surveillance & Cameras', 'Access Control', 'Full System Customization'] },
      { stepIndex: 3, question: "When would you like this scheduled for a consultation?", quickReplies: ['This Weekend', 'Weekday', 'As Soon As Possible'] },
      { stepIndex: 4, question: "Please share your full name and phone number:", quickReplies: [] }
    ];

    let responseContent = '';
    let isQualified = false;
    let quickReplies: string[] = [];

    const phoneMatch = userMessage.match(/(\+91[\-\s]?)?[6-9]\d{9}/);
    if (phoneMatch) {
      extractedData.phone = phoneMatch[0];
    }

    const lowerMsg = userMessage.toLowerCase().trim();

    // --- 4-STEP CONSULTATIVE STATE-MACHINE FLOW ---
    if (currentStepIndex === 1) {
      const validKeywords = ['residential', 'commercial', 'industrial', 'home', 'house', 'office', 'factory', 'apartment', 'building'];
      const isValid = validKeywords.some(kw => lowerMsg.includes(kw));

      if (!isValid) {
        responseContent = `Sorry! We are unable to understand your query. ${intakeSteps[0].question}`;
        quickReplies = intakeSteps[0].quickReplies;
      } else {
        extractedData.propertyType = userMessage;
        currentStepIndex = 2;
        responseContent = `Got it (${userMessage}). ${intakeSteps[1].question}`;
        quickReplies = intakeSteps[1].quickReplies;
      }
    } else if (currentStepIndex === 2) {
      // Step 2: Priority / Scoping Question (Accepts any descriptive answer or quick reply)
      if (userMessage.length < 2) {
        responseContent = `Sorry! We are unable to understand your query. ${intakeSteps[1].question}`;
        quickReplies = intakeSteps[1].quickReplies;
      } else {
        extractedData.priority = userMessage;
        currentStepIndex = 3;
        responseContent = `Understood. ${intakeSteps[2].question}`;
        quickReplies = intakeSteps[2].quickReplies;
      }
    } else if (currentStepIndex === 3) {
      // Step 3: Schedule
      const validSchedule = ['weekend', 'weekday', 'soon', 'asap', 'tomorrow', 'today', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'flexible', 'morning', 'evening'];
      const isValid = validSchedule.some(s => lowerMsg.includes(s));

      if (!isValid) {
        responseContent = `Sorry! We are unable to understand your query. ${intakeSteps[2].question}`;
        quickReplies = intakeSteps[2].quickReplies;
      } else {
        extractedData.schedule = userMessage;
        currentStepIndex = 4;
        responseContent = `Almost done! ${intakeSteps[3].question}`;
        quickReplies = [];
      }
    } else {
      // Step 4: Name & Phone Collection (NO PAYMENT - Consultation Confirmation Only)
      if (phoneMatch) {
        extractedData.phone = phoneMatch[0];
      }

      if (extractedData.name && !extractedData.phone) {
        if (phoneMatch) {
          extractedData.phone = phoneMatch[0];
          lead.firstName = extractedData.name;
          lead.phone = extractedData.phone;
          isQualified = true;
          currentStepIndex = 5;

          responseContent = `Thank you, ${lead.firstName}! We have successfully logged your consultation request for **${verticalName}**.\n\n- Requirement: ${extractedData.initialRequirement || 'General Inquiry'}\n- Property Type: ${extractedData.propertyType || 'Standard'}\n- Priority Scope: ${extractedData.priority || 'General Assessment'}\n- Preferred Schedule: ${extractedData.schedule || 'Flexible'}\n- Contact Phone: ${lead.phone}\n\nOur expert consultant will review your requirements and reach out to you shortly to discuss custom solutions.`;
          quickReplies = [];
        } else {
          responseContent = `Sorry! We are unable to understand your query. Please provide your valid 10-digit mobile phone number:`;
          quickReplies = [];
        }
      } else if (!extractedData.name) {
        const isQuestionOrJunk = lowerMsg.startsWith('who') || lowerMsg.startsWith('what') || lowerMsg.startsWith('how') || lowerMsg.length < 2 || lowerMsg.includes('bot');
        
        if (isQuestionOrJunk) {
          responseContent = `Sorry! We are unable to understand your query. ${intakeSteps[3].question}`;
          quickReplies = [];
        } else {
          extractedData.name = userMessage;
          if (!extractedData.phone) {
            responseContent = `Thanks, ${extractedData.name}. Could you also please provide your 10-digit mobile phone number?`;
            quickReplies = [];
          } else {
            lead.firstName = extractedData.name;
            lead.phone = extractedData.phone;
            isQualified = true;
            currentStepIndex = 5;

            responseContent = `Thank you, ${lead.firstName}! We have successfully logged your consultation request for **${verticalName}**.\n\n- Requirement: ${extractedData.initialRequirement || 'General Inquiry'}\n- Property Type: ${extractedData.propertyType || 'Standard'}\n- Priority Scope: ${extractedData.priority || 'General Assessment'}\n- Preferred Schedule: ${extractedData.schedule || 'Flexible'}\n- Contact Phone: ${lead.phone}\n\nOur expert consultant will review your requirements and reach out to you shortly to discuss custom solutions.`;
            quickReplies = [];
          }
        }
      }
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
        sessionId: activeSessionId,
        metadata: extractedData,
      });
    }

    await this.messageRepository.save({
      sessionId: activeSessionId,
      sender: 'assistant',
      content: responseContent,
      extractedData,
    });

    return {
      sessionId: activeSessionId,
      reply: responseContent,
      isQualified,
      leadId: lead.id,
      extractedData,
      metadata: {
        stepIndex: currentStepIndex,
        quickReplies: isQualified ? [] : quickReplies,
        // Payment gateway URL removed entirely as requested
      },
    };
  }

  async getSessionHistory(sessionId: string) {
    const messages = await this.messageRepository.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });

    return {
      sessionId,
      messages: messages.map(m => ({
        sender: m.sender,
        content: m.content,
        timestamp: m.createdAt,
      })),
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