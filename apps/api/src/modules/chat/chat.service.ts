// apps/api/src/modules/chat/chat.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
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

  // Helper method to get formatted IST timestamp string
  private getIstTimestampString(): string {
    return new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  // Inside chat.service.ts (Entity Extraction / Intent Parser Helper)
  private extractIntentAndLocality(message: string, availableLocalities: string[]) {
    const lowerMsg = message.toLowerCase();
    let intent = null;
    let locality = null;

    // 1. Map keywords to intents
    if (lowerMsg.includes('repair') || lowerMsg.includes('maintenance') || lowerMsg.includes('service') || lowerMsg.includes('troubleshoot') || lowerMsg.includes('cleaning') || lowerMsg.includes('dispatch')) {
      intent = 'Repair & Maintenance';
    } else if (lowerMsg.includes('install') || lowerMsg.includes('setup') || lowerMsg.includes('new') || lowerMsg.includes('buy') || lowerMsg.includes('panel')) {
      intent = 'Plan New Installation';
    } else if (lowerMsg.includes('cost') || lowerMsg.includes('price') || lowerMsg.includes('procedure') || lowerMsg.includes('roi') || lowerMsg.includes('subsidy')) {
      intent = 'Explore Procedure & Costs';
    }

    // 2. Match locality from database list
    const matchedLocality = availableLocalities.find(loc => lowerMsg.includes(loc.toLowerCase()));
    if (matchedLocality) {
      locality = matchedLocality;
    }

    return { intent, locality };
  }

  private extractEntities(message: string, currentData: any = {}) {
    const lower = message.toLowerCase();
    const updated = { ...currentData };

    // 1. Intent Extraction (Priority given to explicit Installation keywords first)
    if (lower.includes('install') || lower.includes('new installation') || lower.includes('setup')) {
      updated.intent = 'New Installation';
    } else if (lower.includes('repair') || lower.includes('maintenance') || lower.includes('damaged') || lower.includes('fix') || lower.includes('troubleshoot')) {
      updated.intent = 'Repair & Maintenance';
    } else if (lower.includes('explore') || lower.includes('procedure') || lower.includes('cost') || lower.includes('subsidy') || lower.includes('roi')) {
      updated.intent = 'Explorer';
    } else if (lower.includes('service') || lower.includes('issue')) {
      updated.intent = 'Repair & Maintenance';
    }

    // 2. System Size Extraction (e.g., 5kW or 5kv typo)
    const kwMatch = message.match(/(\d+)\s*(?:kw|kv|kilowatt)/i);
    if (kwMatch) {
      updated.systemSize = `${kwMatch[1]}kW`;
    }

    // 3. Phone Extraction
    const phoneMatch = message.match(/(\+91[\-\s]?)?[6-9]\d{9}/);
    if (phoneMatch) {
      updated.phone = phoneMatch[0];
    }

    // 4. Free-form Locality Capture
    if (!updated.locality && message.trim().length > 2 && !phoneMatch && !lower.includes('repair') && !lower.includes('install')) {
      if (updated.intent && !updated.selectedBusinessId) {
        updated.locality = message.trim();
      }
    }

    return updated;
  }

  async createSession(userId: string, rawVerticalSlug: string, tenantId?: string, initialMessage?: string) {
    const verticalSlug = rawVerticalSlug.toLowerCase().trim().replace(/\s+/g, '-');
    const sessionId = `visitor_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const istTimeStr = this.getIstTimestampString();

    await this.messageRepository.save({
      sessionId,
      sender: 'system',
      content: `Session started for vertical: ${verticalSlug}`,
    });

    // 1. Fetch available localities dynamically from database businesses for this vertical
    const businesses = await this.businessRepository.find({ where: { verticalSlug } });
    const dbLocalities = Array.from(new Set(businesses.map(b => b.locality)));

    const vertical = await this.verticalRepository.findOne({ where: { slug: verticalSlug } });
    const verticalName = vertical?.name || verticalSlug.replace(/-/g, ' ');

    const cleanedInitialMsg = initialMessage && initialMessage.trim().length > 0 ? initialMessage.trim() : null;
    let extractedData: any = { tenantId };
    
    let initialGreeting = `Hello! I'm your assistant for **${verticalName}**. How can we assist you today?\n\n• **Plan New Installation**: Configure a custom system and book an on-site survey.\n• **Repair & Maintenance**: Request servicing, troubleshooting, or repairs.\n• **Explore Procedure & Costs**: Understand technical roadmaps and ROI first.\n\n*(IST: ${istTimeStr})*`;
    let quickReplies = ['Plan New Installation', 'Repair & Maintenance', 'Explore Procedure & Costs'];

    if (cleanedInitialMsg) {
      await this.messageRepository.save({ sessionId, sender: 'visitor', content: cleanedInitialMsg });
      
      const extracted = this.extractIntentAndLocality(cleanedInitialMsg, dbLocalities);
      extractedData.intent = extracted.intent || extractedData.intent;
      extractedData.locality = extracted.locality || extractedData.locality;
    }

    let initialState = 'GREETING';
    if (extractedData.intent && extractedData.locality) {
      initialState = 'VENDOR_SELECTION';
      initialGreeting = `Got it! You are looking for **${extractedData.intent}** in **${extractedData.locality}**. Here are the verified local service providers available near you:\n\n*(IST: ${istTimeStr})*`;
    } else if (extractedData.intent) {
      initialState = 'LOCALITY_PENDING';
      quickReplies = dbLocalities.length > 0 ? dbLocalities : [];
      initialGreeting = `Understood (**${extractedData.intent}**). Please select or share your locality where service is required:\n\n*(IST: ${istTimeStr})*`;
    }

    const initialLead = this.leadRepository.create({
      sessionId,
      verticalSlug,
      status: LeadStatus.NEW,
      source: 'Public Discovery Marketplace',
      firstName: 'Pending',
      lastName: '',
      phone: '',
      metadata: { state: initialState, extractedData },
    });
    await this.leadRepository.save(initialLead);

    await this.messageRepository.save({
      sessionId,
      sender: 'assistant',
      content: initialGreeting,
      extractedData,
    });

    return {
      sessionId,
      verticalSlug,
      initialMessage: initialGreeting,
      userInitialMessage: cleanedInitialMsg,
      metadata: { state: initialState, quickReplies },
    };
  }

  async processMessage(sessionId: string, userMessage: string) {
    const lead = await this.leadRepository.findOne({ where: { sessionId } });
    if (!lead) throw new Error(`Session ${sessionId} not found`);

    this.screenMessageForThreats(userMessage);

    const metadata = lead.metadata || {};
    const extractedData = metadata.extractedData || {};
    let currentState = metadata.state || 'DISCOVERY';
    const istTimeStr = this.getIstTimestampString();

    // 1. Save visitor message
    await this.messageRepository.save({ sessionId, sender: 'visitor', content: userMessage });

    const lowerMsg = userMessage.toLowerCase().trim();
    let assistantReply = '';

    // 2. HARD LOCK: If session is already completed, do not re-process
    if (currentState === 'COMPLETED' || lead.status === LeadStatus.QUALIFIED) {
      assistantReply = `This session is already completed. How else can we assist you today?\n\n*(IST: ${istTimeStr})*`;
      await this.messageRepository.save({ sessionId, sender: 'assistant', content: assistantReply });
      return { sessionId, reply: assistantReply, metadata: { state: currentState, extractedData } };
    }

    // 3. HARD INTERCEPT: Check if user provided 10-digit phone number at ANY stage
    const phoneRegex = /\d{10}/;
    const phoneMatch = userMessage.match(phoneRegex);

    if (phoneMatch) {
      lead.phone = phoneMatch[0];
      const namePart = userMessage.replace(phoneMatch[0], '').replace(/[,]/g, '').trim();
      if (namePart) lead.firstName = namePart;

      lead.status = LeadStatus.QUALIFIED;
      currentState = 'COMPLETED';
      
      assistantReply = `Thank you, **${lead.firstName || 'Customer'}**! Your inquiry regarding *${extractedData.intent || 'Service Request'}* in **${extractedData.locality || 'your area'}** has been successfully registered. Our regional specialist will call you at ${lead.phone} shortly.\n\n*(IST: ${istTimeStr})*`;

      lead.metadata = { state: currentState, extractedData };
      await this.leadRepository.save(lead);
      await this.messageRepository.save({ sessionId, sender: 'assistant', content: assistantReply });
      return { sessionId, reply: assistantReply, metadata: { state: currentState, extractedData } };
    }

    // 4. STRICT LINEAR STATE MACHINE (Zero Fallthroughs to Prevent Loops)
    switch (currentState) {
      case 'DISCOVERY':
      case 'GREETING': {
        if (lowerMsg.includes('cost') || lowerMsg.includes('price') || lowerMsg.includes('procedure') || lowerMsg.includes('roi') || lowerMsg.includes('subsidy')) {
          extractedData.intent = 'Explore Procedure & Costs';
        } else if (lowerMsg.includes('repair') || lowerMsg.includes('maintenance') || lowerMsg.includes('service') || lowerMsg.includes('dispatch')) {
          extractedData.intent = 'Repair & Maintenance';
        } else {
          extractedData.intent = 'Plan New Installation';
        }

        if (lowerMsg.includes('panel') || lowerMsg.includes('solar') || lowerMsg.includes('charger') || lowerMsg.includes('battery')) {
          extractedData.requestedItem = userMessage.trim();
        }

        currentState = 'LOCALITY_PENDING';
        assistantReply = `Understood (**${extractedData.intent}**). Please share your locality or area where service is required:\n\n*(IST: ${istTimeStr})*`;
        break;
      }

      case 'LOCALITY_PENDING': {
        extractedData.locality = userMessage.trim();

        const businesses = await this.businessRepository.find({ where: { verticalSlug: lead.verticalSlug } });
        const matchingBusinesses = businesses.filter(
          b => b.locality.toLowerCase() === extractedData.locality.toLowerCase()
        );

        if (matchingBusinesses.length > 0) {
          const businessList = matchingBusinesses.map(b => `• **${b.name}** (Rating: ${b.rating}⭐)`).join('\n');
          assistantReply = `I found verified providers for **${extractedData.intent}** in **${extractedData.locality}**:\n\n${businessList}\n\nPlease share your full name and 10-digit mobile number so our team can coordinate:\n\n*(IST: ${istTimeStr})*`;
        } else {
          assistantReply = `Thank you for sharing your location. While our primary partner network is currently expanding into **${extractedData.locality}**, our regional engineering team would be delighted to assist you with a custom service arrangement.\n\nPlease share your full name and 10-digit mobile phone number, and our specialist will reach out to coordinate your request:\n\n*(IST: ${istTimeStr})*`;
        }

        currentState = 'CONTACT_PENDING';
        break;
      }

      case 'CONTACT_PENDING': {
        assistantReply = `Please share your full name and 10-digit mobile phone number so our specialist can finalize your request:\n\n*(IST: ${istTimeStr})*`;
        break;
      }

      default: {
        currentState = 'CONTACT_PENDING';
        assistantReply = `Please share your full name and 10-digit mobile phone number so our specialist can finalize your request:\n\n*(IST: ${istTimeStr})*`;
        break;
      }
    }

    lead.metadata = { state: currentState, extractedData };
    await this.leadRepository.save(lead);
    await this.messageRepository.save({ sessionId, sender: 'assistant', content: assistantReply });

    return {
      sessionId,
      reply: assistantReply,
      metadata: { state: currentState, extractedData },
    };
  }

  private async processServiceOrContact(verticalSlug: string, verticalName: string, sessionId: string, lead: Lead, extractedData: any, selectedVendor: BusinessEntity) {
    let targetServices = selectedVendor.services;
    if (extractedData.intent === 'Repair & Maintenance') {
      targetServices = selectedVendor.services.filter((s: ServiceEntity) => 
        s.name.toLowerCase().includes('repair') || 
        s.name.toLowerCase().includes('servicing') || 
        s.name.toLowerCase().includes('maintenance') ||
        s.name.toLowerCase().includes('audit')
      );
      if (targetServices.length === 0) targetServices = selectedVendor.services;
    }

    extractedData.availableServices = targetServices;
    const currentState = 'SERVICE_SELECTION';

    const serviceList = targetServices.map((s: ServiceEntity) => `• **${s.name}**${s.basePrice ? ` (₹${s.basePrice})` : ''}`).join('\n');
    const responseContent = `You selected **${selectedVendor.name}** (${selectedVendor.rating}★). Available service packages for your **${extractedData.intent}** request:\n\n${serviceList}\n\nPlease select your preferred service package:`;
    const quickReplies = targetServices.map((s: ServiceEntity) => s.name);

    lead.metadata = { state: currentState, extractedData };
    await this.leadRepository.save(lead);

    await this.messageRepository.save({
      sessionId,
      sender: 'assistant',
      content: responseContent,
      extractedData,
    });

    return {
      sessionId,
      reply: responseContent,
      isQualified: false,
      leadId: lead.id,
      extractedData,
      metadata: { state: currentState, quickReplies },
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