// apps/api/src/modules/chat/chat.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueService } from '../queue/queue.service.js';
import { Lead, LeadStatus } from '../lead/lead.entity.js';
import { Message } from '../consumer-chat/message.entity.js';
import { VerticalEntity } from '../tenant/entities/domain.entity.js';
import { BusinessEntity } from '../tenant/entities/business.entity.js';
import { ServiceEntity } from '../tenant/entities/service.entity.js';

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
    @InjectRepository(BusinessEntity)
    private readonly businessRepository: Repository<BusinessEntity>,
    @InjectRepository(ServiceEntity)
    private readonly serviceRepository: Repository<ServiceEntity>,
  ) {}

  private async getVerticalIntakeSteps(verticalSlug: string, verticalName: string) {
    const vertical = await this.verticalRepository.findOne({ where: { slug: verticalSlug } });
    if (vertical && vertical.intakeSteps && vertical.intakeSteps.length > 0) {
      return vertical.intakeSteps;
    }

    // Default Fallback with Intent Forking (Step 1)
    return [
      {
        stepIndex: 1,
        question: `Welcome! I am your technical advisor for ${verticalName}. How can we assist you today?\n\n• **Plan New Installation**: Configure a custom system and book an on-site survey.\n• **Repair & Maintenance**: Request servicing, troubleshooting, or repairs.\n• **Explore Procedure & Costs**: Understand technical roadmaps and ROI first.`,
        quickReplies: ['Plan New Installation', 'Repair & Maintenance', 'Explore Procedure & Costs'],
      },
      { stepIndex: 2, question: `Please share your locality/area (e.g., Hanamkonda, Warangal):`, quickReplies: ['Hanamkonda', 'Warangal', 'Secunderabad'] },
      { stepIndex: 3, question: `Please share your full name and 10-digit mobile phone number:`, quickReplies: [] },
    ];
  }

  async createSession(userId: string, verticalSlug: string, tenantId?: string, initialMessage?: string) {
    const sessionId = `visitor_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    await this.messageRepository.save({
      sessionId,
      sender: 'system',
      content: `Session started for vertical: ${verticalSlug}`,
    });

    const vertical = await this.verticalRepository.findOne({ where: { slug: verticalSlug } });
    const verticalName = vertical?.name || verticalSlug.replace(/-/g, ' ');
    const intakeSteps = await this.getVerticalIntakeSteps(verticalSlug, verticalName);

    const cleanedInitialMsg = initialMessage && initialMessage.trim().length > 0 ? initialMessage.trim() : null;
    if (cleanedInitialMsg) {
      await this.messageRepository.save({ sessionId, sender: 'visitor', content: cleanedInitialMsg });
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
      metadata: { stepIndex: 1, quickReplies: intakeSteps[0].quickReplies },
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
    const intakeSteps = await this.getVerticalIntakeSteps(verticalSlug, verticalName);
    const maxSteps = intakeSteps.length;

    let responseContent = '';
    let isQualified = false;
    let quickReplies: string[] = [];
    const lowerMsg = userMessage.toLowerCase().trim();

    const phoneMatch = userMessage.match(/(\+91[\-\s]?)?[6-9]\d{9}/);
    if (phoneMatch) {
      extractedData.phone = phoneMatch[0];
    }

    // --- MARKETPLACE STATE MACHINE WORKFLOW ---
    if (currentStepIndex === 1) {
      // Step 1: Intent Forking
      if (lowerMsg.includes('repair') || lowerMsg.includes('maintenance')) {
        extractedData.intent = 'Repair & Maintenance';
      } else if (lowerMsg.includes('explore') || lowerMsg.includes('procedure') || lowerMsg.includes('cost')) {
        extractedData.intent = 'Explorer';
        responseContent = `I'd be glad to walk you through the procedures, approvals, and technical roadmaps! Whenever you feel ready to configure a project, let me know.`;
        quickReplies = ['Plan New Installation', 'Repair & Maintenance'];
        lead.metadata = { stepIndex: currentStepIndex, extractedData };
        await this.leadRepository.save(lead);
        await this.messageRepository.save({ sessionId: activeSessionId, sender: 'assistant', content: responseContent, extractedData });
        return { sessionId: activeSessionId, reply: responseContent, isQualified: false, leadId: lead.id, extractedData, metadata: { stepIndex: currentStepIndex, quickReplies } };
      } else {
        extractedData.intent = 'New Installation';
      }

      currentStepIndex = 2;
      responseContent = `Understood (${extractedData.intent}). To find certified specialists near you, what is your locality or area (e.g., Hanamkonda, Warangal)?`;
      quickReplies = ['Hanamkonda', 'Warangal', 'Secunderabad'];
    } 
    else if (currentStepIndex === 2) {
      // Step 2: Locality Capture & Local Business Listing Query
      extractedData.locality = userMessage;
      currentStepIndex = 3;

      // Query verified local businesses in this locality offering this vertical
      const localBusinesses = await this.businessRepository.find({
        where: { verticalSlug, locality: userMessage, isActive: true },
        relations: { services: true },
      });

      if (localBusinesses.length > 0) {
        extractedData.availableBusinesses = localBusinesses;
        responseContent = `Here are the top-rated certified providers in **${userMessage}** for **${verticalName}**. Please select a provider to view their service packages:`;
        quickReplies = localBusinesses.map((b) => b.name);
      } else {
        // Fallback if no local vendor registered in that exact locality
        responseContent = `We are expanding our network in ${userMessage}! Let's collect your requirements so our regional partner can reach out. ${intakeSteps[1]?.question || 'Please share your details:'}`;
        quickReplies = intakeSteps[1]?.quickReplies || [];
      }
    } 
    else if (currentStepIndex === 3 && extractedData.availableBusinesses) {
      // Step 3: Vendor Selection & Service Menu Display
      const selectedVendor = extractedData.availableBusinesses.find(
        (b: BusinessEntity) => b.name.toLowerCase() === lowerMsg || b.name.toLowerCase().includes(lowerMsg)
      );

      if (!selectedVendor) {
        responseContent = `Please select a valid provider from the list provided below:`;
        quickReplies = extractedData.availableBusinesses.map((b: BusinessEntity) => b.name);
      } else {
        extractedData.selectedBusinessId = selectedVendor.id;
        extractedData.selectedBusinessName = selectedVendor.name;
        currentStepIndex = 4;

        const serviceList = selectedVendor.services.map((s: ServiceEntity) => `• **${s.name}**${s.basePrice ? ` (₹${s.basePrice})` : ''}`).join('\n');
        responseContent = `You selected **${selectedVendor.name}** (${selectedVendor.rating}★). Their available service packages:\n\n${serviceList}\n\nPlease select your preferred service package:`;
        quickReplies = selectedVendor.services.map((s: ServiceEntity) => s.name);
      }
    } 
    else if (currentStepIndex === 4 && extractedData.selectedBusinessId) {
      // Step 4: Service Package Selection & Final Contact Prompt
      extractedData.selectedService = userMessage;
      currentStepIndex = 5;

      responseContent = `Almost done! Please share your full name and 10-digit mobile phone number so **${extractedData.selectedBusinessName}** can coordinate your booking:`;
      quickReplies = [];
    } 
    else {
      // Step 5: Name & Phone Parsing and Final Qualification
      let cleanName = '';
      if (userMessage.includes(',')) {
        const parts = userMessage.split(',');
        cleanName = parts[0].replace(/name[:\s]*/gi, '').trim();
      } else {
        const nameMatch = userMessage.match(/(?:name[:\s]*)([a-zA-Z\s]+)(?:[,;\n]|$)/i) || userMessage.match(/^([a-zA-Z\s]{2,30})$/);
        if (nameMatch) {
          cleanName = (nameMatch[1] || nameMatch[0]).replace(/phone|number|[:,\-\s0-9]/gi, '').trim();
        }
      }

      if (cleanName && cleanName.length > 1) {
        extractedData.name = cleanName;
      } else if (!extractedData.name && !phoneMatch && userMessage.length > 2) {
        extractedData.name = userMessage.replace(/[:,-]/g, ' ').trim();
      }

      if (extractedData.name && extractedData.phone) {
        lead.firstName = extractedData.name;
        lead.phone = extractedData.phone;
        isQualified = true;
        currentStepIndex = 6;

        responseContent = `Thank you, ${lead.firstName}! Your booking with **${extractedData.selectedBusinessName || 'our certified partner'}** has been successfully logged.\n\n- Vertical: ${verticalName}\n- Intent: ${extractedData.intent}\n- Locality: ${extractedData.locality}\n- Selected Service: ${extractedData.selectedService || 'Standard Package'}\n- Contact Phone: ${lead.phone}\n\nThe provider's specialist will reach out to you shortly.`;
        quickReplies = [];
      } else {
        responseContent = `Please provide your full name and valid 10-digit mobile phone number to confirm your booking:`;
        quickReplies = [];
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