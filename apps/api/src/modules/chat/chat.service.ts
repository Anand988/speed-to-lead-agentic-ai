// apps/api/src/modules/chat/chat.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueService } from '../queue/queue.service.js';
import { Lead, LeadStatus } from '../lead/lead.entity.js';
import { Message } from '../consumer-chat/message.entity.js';
import { VerticalEntity } from '../tenant/entities/vertical.entity.js';
import { BusinessEntity } from '../tenant/entities/business.entity.js';
import { ServiceEntity } from '../tenant/entities/service.entity.js';
import { DeepSeekExtractorService } from './deepseek-extractor.service.js';
import { VerticalPromptService } from '../consumer-chat/vertical-prompt.service.js';
import { CANONICAL_INTENTS, normalizeIntent } from './chat-intents.constants.js';
import { ChatCacheService } from './chat-cache.service.js';

const VENDOR_CACHE_TTL_SECONDS = 300;

export interface CachedVendorSummary {
  id: string;
  name: string;
  rating: number;
  locality: string;
}

export interface CachedVerticalVendors {
  businesses: CachedVendorSummary[];
  localities: string[];
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly deepSeekExtractorService: DeepSeekExtractorService,
    private readonly verticalPromptService: VerticalPromptService,
    private readonly chatCacheService: ChatCacheService,
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

  private normalizeLocalityKey(locality: string): string {
    return locality.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private async getVerticalVendorsCached(verticalSlug: string): Promise<CachedVerticalVendors> {
    const cacheKey = `vendors:${verticalSlug}:__all__`;
    const cached = await this.chatCacheService.getJson<CachedVerticalVendors>(cacheKey);
    if (cached) {
      return cached;
    }

    const rows = await this.businessRepository.find({
      where: { verticalSlug },
    });

    const businesses: CachedVendorSummary[] = rows.map((b) => ({
      id: b.id,
      name: b.name,
      rating: b.rating || 4.5,
      locality: b.locality,
    }));
    const localities = Array.from(new Set(businesses.map((b) => b.locality).filter(Boolean)));

    const payload: CachedVerticalVendors = { businesses, localities };
    await this.chatCacheService.setJson(cacheKey, payload, VENDOR_CACHE_TTL_SECONDS);
    return payload;
  }

  private async getMatchingVendorsForLocality(
    verticalSlug: string,
    targetLocality: string,
    allBusinesses: CachedVendorSummary[],
  ): Promise<CachedVendorSummary[]> {
    const normalizedLocality = this.normalizeLocalityKey(targetLocality);
    if (!normalizedLocality) return [];

    const cacheKey = `vendors:${verticalSlug}:${normalizedLocality}`;
    const cached = await this.chatCacheService.getJson<CachedVendorSummary[]>(cacheKey);
    if (cached) {
      this.logger.debug(`[Vendor Cache Hit] key="${cacheKey}"`);
      return cached;
    }

    const matching = allBusinesses
      .filter((b) => this.matchesLocality(b.locality, targetLocality))
      .map((b) => ({
        id: b.id,
        name: b.name,
        rating: b.rating || 4.5,
        locality: b.locality,
      }));

    await this.chatCacheService.setJson(cacheKey, matching, VENDOR_CACHE_TTL_SECONDS);
    return matching;
  }

  async invalidateVendorCache(verticalSlug: string): Promise<number> {
    return this.chatCacheService.delByPrefix(`vendors:${verticalSlug}:`);
  }

  private matchDeterministicInput(
    userMessage: string,
    currentState: string,
    dbLocalities: string[],
    currentData: any,
  ): { handled: boolean; data: any } {
    const trimmed = userMessage.trim();
    const lower = trimmed.toLowerCase();

    // 1. Late states never need LLM extraction
    if (['VENDOR_SELECTION', 'SERVICE_SELECTION', 'CONTACT_PENDING'].includes(currentState)) {
      return { handled: true, data: currentData };
    }

    // 2. Simple greeting or unrealistic BHK
    if (this.isSimpleGreeting(trimmed) || this.getUnrealisticBhkValue(trimmed) !== null) {
      return {
        handled: true,
        data: {
          ...currentData,
          outOfVertical: false,
          clarificationNeeded: false,
          extractionFailed: false,
        },
      };
    }

    // 3. Exact match on any intent or quick-reply button
    const mappedIntent = normalizeIntent(trimmed);
    if (mappedIntent) {
      return {
        handled: true,
        data: {
          ...currentData,
          intent: mappedIntent,
          outOfVertical: false,
          clarificationNeeded: false,
          extractionFailed: false,
        },
      };
    }

    // 4. Deterministic city or 5-digit ZIP input when waiting for locality (0 LLM calls)
    if (currentState === 'LOCALITY_PENDING') {
      const isZipCode = /^\d{5}(-\d{4})?$/.test(trimmed);
      const isShortLocation =
        /^[a-zA-Z0-9\s,.-]{2,40}$/.test(trimmed) && trimmed.split(/\s+/).length <= 3;

      if (isZipCode || isShortLocation) {
        const exactLocality = dbLocalities.find((loc) => loc.toLowerCase() === lower);
        return {
          handled: true,
          data: {
            ...currentData,
            locality: exactLocality || trimmed,
            outOfVertical: false,
            extractionFailed: false,
          },
        };
      }
    }

    return { handled: false, data: currentData };
  }

  private getIstTimestampString(): string {
    return new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  private isInappropriateMessage(message?: string | null): boolean {
    if (!message) return false;
    const lower = message.toLowerCase();
    const blockedPatterns = [
      /\bnude(s)?\b/i,
      /\bporn\b/i,
      /\bxxx\b/i,
      /\bsex(ual)?\b/i,
      /\bnsfw\b/i,
      /\bexplicit\b/i,
    ];
    return blockedPatterns.some((pattern) => pattern.test(lower));
  }

  private isSimpleGreeting(message?: string | null): boolean {
    if (!message) return true;
    return /^(hi|hello|hey|good\s*(morning|afternoon|evening)|namaste|hola)[\s!.,?]*$/i.test(
      message.trim(),
    );
  }

  private getUnrealisticBhkValue(input?: string | null): number | null {
    if (!input) return null;
    const match = input.trim().match(/^(\d+)\s*bhk$/i);
    if (!match) return null;
    const count = Number(match[1]);
    return Number.isFinite(count) && count > 10 ? count : null;
  }

  private matchesLocality(businessLocality: string | undefined, targetLocality: string | undefined): boolean {
    if (!businessLocality || !targetLocality) return false;
    const a = businessLocality.toLowerCase().trim();
    const b = targetLocality.toLowerCase().trim();
    return a === b || a.includes(b) || b.includes(a);
  }

  private buildClarificationActions(subject: string, verticalSlug: string, suggested?: unknown): string[] {
    if (Array.isArray(suggested) && suggested.length > 0) {
      return suggested.map((item) => String(item).trim()).filter(Boolean).slice(0, 4);
    }
    const cleanSubject = subject.trim() || 'this item';
    if (verticalSlug.includes('security') || verticalSlug.includes('camera')) {
      return [
        `Buy & Install ${cleanSubject}`,
        `${cleanSubject} Repair & Troubleshooting`,
        `Upgrade Existing Security System`,
      ];
    }
    return [...CANONICAL_INTENTS];
  }

  private buildOutOfVerticalReply(
    userInput: string,
    verticalName: string,
    suggestedVerticalName: string | null | undefined,
    istTimeStr: string,
  ): string {
    if (suggestedVerticalName) {
      return `It looks like **"${userInput}"** falls outside **${verticalName}**. Please close this session and select **${suggestedVerticalName}** from the service dropdown, or choose one of the **${verticalName}** options below:\n\n*(IST: ${istTimeStr})*`;
    }
    return `It looks like **"${userInput}"** isn't a service covered under **${verticalName}** (or our home/commercial service categories). Please pick one of the **${verticalName}** options below if you need assistance here:\n\n*(IST: ${istTimeStr})*`;
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

    const { businesses, localities: dbLocalities } = await this.getVerticalVendorsCached(verticalSlug);

    const vertical = await this.verticalRepository.findOne({ where: { slug: verticalSlug } });
    const verticalName = vertical?.name || verticalSlug.replace(/-/g, ' ');
    let quickReplies = await this.verticalPromptService.getQuickRepliesForVertical(verticalSlug);

    const cleanedInitialMsg = initialMessage && initialMessage.trim().length > 0 ? initialMessage.trim() : null;
    let extractedData: any = { tenantId };

    let initialState = 'GREETING';
    let initialGreeting = '';
    let uiPayload: any = null;
    let uiComponentType = 'LOCALITY_CHIPS';

    if (cleanedInitialMsg) {
      await this.messageRepository.save({ sessionId, sender: 'visitor', content: cleanedInitialMsg });

      if (this.isInappropriateMessage(cleanedInitialMsg)) {
        extractedData.outOfVertical = true;
        extractedData.suggestedVerticalName = null;
      } else {
        const deterministic = this.matchDeterministicInput(
          cleanedInitialMsg,
          initialState,
          dbLocalities,
          extractedData,
        );

        if (deterministic.handled) {
          this.logger.debug(`[LLM Skipped] Deterministic initial message: "${cleanedInitialMsg}"`);
          extractedData = deterministic.data;
        } else {
          extractedData = await this.deepSeekExtractorService.extractEntities(
            verticalSlug,
            cleanedInitialMsg,
            dbLocalities,
            initialState,
            extractedData,
            sessionId,
          );

          // If LLM returned nothing on a non-greeting, non-BHK message (and did not fail with 429/timeout), treat as out-of-scope
          if (
            !extractedData.extractionFailed &&
            !extractedData.outOfVertical &&
            !extractedData.intent &&
            !extractedData.clarificationNeeded &&
            !this.isSimpleGreeting(cleanedInitialMsg) &&
            this.getUnrealisticBhkValue(cleanedInitialMsg) === null
          ) {
            extractedData.outOfVertical = true;
            extractedData.suggestedVerticalName = null;
          }
        }
      }
    }

    const clarificationSubject =
      extractedData.subject ||
      (extractedData.clarificationNeeded && cleanedInitialMsg ? cleanedInitialMsg : null);
    const unrealisticBhk = this.getUnrealisticBhkValue(clarificationSubject || cleanedInitialMsg);

    if (extractedData.extractionFailed) {
      initialState = 'GREETING';
      initialGreeting = `I'm experiencing a brief connection hiccup while processing **"${cleanedInitialMsg}"**. Please pick one of the **${verticalName}** options below or try again in a moment:\n\n*(IST: ${istTimeStr})*`;
    } else if (extractedData.outOfVertical) {
      initialState = 'GREETING';
      initialGreeting = this.buildOutOfVerticalReply(
        cleanedInitialMsg || 'your message',
        verticalName,
        extractedData.suggestedVerticalName,
        istTimeStr,
      );
    } else if (extractedData.intent && extractedData.locality) {
      const matchingBusinesses = await this.getMatchingVendorsForLocality(
        verticalSlug,
        extractedData.locality as string,
        businesses,
      );

      if (matchingBusinesses.length > 0) {
        uiPayload = matchingBusinesses;
        uiComponentType = 'VENDOR_CARDS';
        initialState = 'VENDOR_SELECTION';
        quickReplies = [];
        initialGreeting = `I found verified providers for **${extractedData.intent}** in **${extractedData.locality}**. Select a provider below or share your contact details:\n\n*(IST: ${istTimeStr})*`;
      } else {
        initialState = 'CONTACT_PENDING';
        uiComponentType = 'CONTACT_PENDING';
        quickReplies = [];
        initialGreeting = `Our network is expanding into **${extractedData.locality}**. Please share your full name and 10-digit mobile phone number so our regional team can coordinate:\n\n*(IST: ${istTimeStr})*`;
      }
    } else if (extractedData.intent) {
      initialState = 'LOCALITY_PENDING';
      quickReplies = [];
      initialGreeting = `Understood (**${extractedData.intent}**). Please enter your city or ZIP code where service is required:\n\n*(IST: ${istTimeStr})*`;
    } else if (unrealisticBhk !== null) {
      extractedData.subject = null;
      extractedData.clarificationNeeded = true;
      initialState = 'INTENT_CLARIFICATION';
      quickReplies = ['1BHK', '2BHK', '3BHK', '4BHK', 'Commercial / Large Property'];
      initialGreeting = `**${unrealisticBhk}BHK** doesn't look like a standard residential layout—did you mean a standard home size like **1BHK–4BHK**, or are you looking for commercial / large-property service?\n\n*(IST: ${istTimeStr})*`;
    } else if (extractedData.clarificationNeeded && clarificationSubject) {
      extractedData.subject = clarificationSubject;
      initialState = 'INTENT_CLARIFICATION';
      quickReplies = this.buildClarificationActions(
        clarificationSubject,
        verticalSlug,
        extractedData.suggestedActions,
      );
      initialGreeting = `Got it—you mentioned **${clarificationSubject}**. What would you like me to help you with regarding **${clarificationSubject}**—are you looking to purchase/install it, get repair or servicing help, or request a quote?\n\n*(IST: ${istTimeStr})*`;
    } else {
      initialState = 'GREETING';
      initialGreeting = `Hello! I'm your assistant for **${verticalName}**. How can we assist you today?\n\n*(IST: ${istTimeStr})*`;
    }

    const initialLead = this.leadRepository.create({
      sessionId,
      verticalSlug,
      status: LeadStatus.NEW,
      source: 'Public Discovery Marketplace',
      firstName: 'Pending',
      lastName: '',
      phone: '',
      metadata: { state: initialState, extractedData, uiComponentType, uiPayload, quickReplies },
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
      metadata: { state: initialState, quickReplies, uiComponentType, uiPayload },
    };
  }

  async processMessage(sessionId: string, userMessage: string) {
    const lead = await this.leadRepository.findOne({ where: { sessionId } });
    if (!lead) throw new Error(`Session ${sessionId} not found`);

    this.screenMessageForThreats(userMessage);

    const metadata = lead.metadata || {};
    let extractedData = metadata.extractedData || {};
    let currentState = metadata.state || 'DISCOVERY';
    const istTimeStr = this.getIstTimestampString();

    await this.messageRepository.save({ sessionId, sender: 'visitor', content: userMessage });

    let assistantReply = '';

    if (currentState === 'COMPLETED' || lead.status === LeadStatus.QUALIFIED) {
      assistantReply = `This session is already completed. How else can we assist you today?\n\n*(IST: ${istTimeStr})*`;
      await this.messageRepository.save({ sessionId, sender: 'assistant', content: assistantReply });
      return { sessionId, reply: assistantReply, metadata: { state: currentState, extractedData } };
    }

    const phoneRegex = /\d{10}/;
    const phoneMatch = userMessage.match(phoneRegex);

    if (phoneMatch) {
      lead.phone = phoneMatch[0];
      const namePart = userMessage.replace(phoneMatch[0], '').replace(/[,]/g, '').trim();
      if (namePart) lead.firstName = namePart;

      lead.status = LeadStatus.QUALIFIED;
      currentState = 'COMPLETED';

      assistantReply = `Thank you, **${lead.firstName || 'Customer'}**! Your inquiry regarding *${extractedData.intent || 'Service Request'}* in **${extractedData.locality || 'your area'}** has been successfully registered. Our regional specialist will call you at ${lead.phone} shortly.\n\n*(IST: ${istTimeStr})*`;

      lead.metadata = { state: currentState, extractedData, quickReplies: [] };
      await this.leadRepository.save(lead);

      try {
        await this.queueService.dispatchQualifiedLead(lead.id, {
          leadId: lead.id,
          phone: lead.phone,
          intent: extractedData.intent || 'General Service',
          locality: extractedData.locality || 'Not specified',
          verticalSlug: lead.verticalSlug,
          firstName: lead.firstName,
        });
      } catch (queueError) {
        this.logger.error(`Failed to enqueue lead dispatch job for Lead ID: ${lead.id}`, queueError);
      }

      await this.messageRepository.save({ sessionId, sender: 'assistant', content: assistantReply });
      return { sessionId, reply: assistantReply, metadata: { state: currentState, extractedData, quickReplies: [] } };
    }

    const { businesses, localities: dbLocalities } = await this.getVerticalVendorsCached(lead.verticalSlug);

    const previousSubject = extractedData.subject;

    if (this.isInappropriateMessage(userMessage)) {
      extractedData = {
        ...extractedData,
        outOfVertical: true,
        suggestedVerticalName: null,
        extractionFailed: false,
      };
    } else {
      const deterministic = this.matchDeterministicInput(
        userMessage,
        currentState,
        dbLocalities,
        extractedData,
      );

      if (deterministic.handled) {
        this.logger.debug(`[LLM Skipped] Deterministic turn in state=${currentState} for "${userMessage.trim()}"`);
        extractedData = deterministic.data;
      } else {
        extractedData = await this.deepSeekExtractorService.extractEntities(
          lead.verticalSlug,
          userMessage,
          dbLocalities,
          currentState,
          extractedData,
          sessionId,
        );
        if (!extractedData.subject && previousSubject && !extractedData.outOfVertical) {
          extractedData.subject = previousSubject;
        }
      }
    }

    let activeQuickReplies: string[] = [];

    switch (currentState) {
      case 'DISCOVERY':
      case 'GREETING': {
        if (extractedData.extractionFailed) {
          const vertical = await this.verticalRepository.findOne({ where: { slug: lead.verticalSlug } });
          const verticalName = vertical?.name || lead.verticalSlug.replace(/-/g, ' ');
          currentState = 'GREETING';
          activeQuickReplies = await this.verticalPromptService.getQuickRepliesForVertical(lead.verticalSlug);
          assistantReply = `I'm experiencing a brief connection hiccup while processing **"${userMessage.trim()}"**. Please pick one of the **${verticalName}** options below or try again in a moment:\n\n*(IST: ${istTimeStr})*`;
          break;
        }

        if (
          extractedData.outOfVertical ||
          (!extractedData.intent &&
            !extractedData.clarificationNeeded &&
            !this.isSimpleGreeting(userMessage) &&
            this.getUnrealisticBhkValue(userMessage) === null)
        ) {
          const vertical = await this.verticalRepository.findOne({ where: { slug: lead.verticalSlug } });
          const verticalName = vertical?.name || lead.verticalSlug.replace(/-/g, ' ');
          currentState = 'GREETING';
          activeQuickReplies = await this.verticalPromptService.getQuickRepliesForVertical(lead.verticalSlug);
          assistantReply = this.buildOutOfVerticalReply(
            userMessage.trim(),
            verticalName,
            extractedData.suggestedVerticalName,
            istTimeStr,
          );
          break;
        }

        const clarificationSubject =
          extractedData.subject || (extractedData.clarificationNeeded ? userMessage.trim() : null);
        const unrealisticBhk = this.getUnrealisticBhkValue(clarificationSubject || userMessage);

        if (extractedData.intent && extractedData.locality) {
          const matchingBusinesses = await this.getMatchingVendorsForLocality(
            lead.verticalSlug,
            extractedData.locality as string,
            businesses,
          );

          if (matchingBusinesses.length > 0) {
            const uiPayload = matchingBusinesses;

            currentState = 'VENDOR_SELECTION';
            assistantReply = `I found verified providers for **${extractedData.intent}** in **${extractedData.locality}**. Select a provider below or share your contact details:\n\n*(IST: ${istTimeStr})*`;

            lead.metadata = { state: currentState, extractedData, uiComponentType: 'VENDOR_CARDS', uiPayload, quickReplies: [] };
            await this.leadRepository.save(lead);
            await this.messageRepository.save({ sessionId, sender: 'assistant', content: assistantReply, extractedData });

            return {
              sessionId,
              reply: assistantReply,
              metadata: { state: currentState, extractedData, uiComponentType: 'VENDOR_CARDS', uiPayload, quickReplies: [] },
            };
          }
        }

        if (extractedData.intent) {
          currentState = 'LOCALITY_PENDING';
          activeQuickReplies = [];
          assistantReply = `Understood (**${extractedData.intent}**). Please enter your city or ZIP code where service is required:\n\n*(IST: ${istTimeStr})*`;
          break;
        }

        if (unrealisticBhk !== null) {
          extractedData.subject = null;
          extractedData.clarificationNeeded = true;
          currentState = 'INTENT_CLARIFICATION';
          activeQuickReplies = ['1BHK', '2BHK', '3BHK', '4BHK', 'Commercial / Large Property'];
          assistantReply = `**${unrealisticBhk}BHK** doesn't look like a standard residential layout—did you mean a standard home size like **1BHK–4BHK**, or are you looking for commercial / large-property service?\n\n*(IST: ${istTimeStr})*`;
          break;
        }

        if (extractedData.clarificationNeeded && clarificationSubject) {
          extractedData.subject = clarificationSubject;
          currentState = 'INTENT_CLARIFICATION';
          activeQuickReplies = this.buildClarificationActions(
            clarificationSubject,
            lead.verticalSlug,
            extractedData.suggestedActions,
          );
          assistantReply = `Got it—you mentioned **${clarificationSubject}**. What would you like me to help you with regarding **${clarificationSubject}**—are you looking to purchase/install it, get repair/servicing help, or request a quote?\n\n*(IST: ${istTimeStr})*`;
          break;
        }

        currentState = 'GREETING';
        activeQuickReplies = await this.verticalPromptService.getQuickRepliesForVertical(lead.verticalSlug);
        assistantReply = `Could you share a bit more detail on what service you need today?\n\n*(IST: ${istTimeStr})*`;
        break;
      }

      case 'INTENT_CLARIFICATION': {
        if (extractedData.extractionFailed) {
          const vertical = await this.verticalRepository.findOne({ where: { slug: lead.verticalSlug } });
          const verticalName = vertical?.name || lead.verticalSlug.replace(/-/g, ' ');
          currentState = 'GREETING';
          activeQuickReplies = await this.verticalPromptService.getQuickRepliesForVertical(lead.verticalSlug);
          assistantReply = `I'm experiencing a brief connection hiccup while processing **"${userMessage.trim()}"**. Please pick one of the **${verticalName}** options below or try again in a moment:\n\n*(IST: ${istTimeStr})*`;
          break;
        }

        if (extractedData.outOfVertical) {
          const vertical = await this.verticalRepository.findOne({ where: { slug: lead.verticalSlug } });
          const verticalName = vertical?.name || lead.verticalSlug.replace(/-/g, ' ');
          currentState = 'GREETING';
          activeQuickReplies = await this.verticalPromptService.getQuickRepliesForVertical(lead.verticalSlug);
          assistantReply = this.buildOutOfVerticalReply(
            userMessage.trim(),
            verticalName,
            extractedData.suggestedVerticalName,
            istTimeStr,
          );
          break;
        }

        const unrealisticBhk = this.getUnrealisticBhkValue(userMessage);
        if (unrealisticBhk !== null) {
          extractedData.subject = null;
          currentState = 'INTENT_CLARIFICATION';
          activeQuickReplies = ['1BHK', '2BHK', '3BHK', '4BHK', 'Commercial / Large Property'];
          assistantReply = `**${unrealisticBhk}BHK** doesn't look like a standard residential layout—please pick **1BHK–4BHK** or **Commercial / Large Property**:\n\n*(IST: ${istTimeStr})*`;
          break;
        }

        if (!extractedData.intent) {
          const updatedSubject = extractedData.subject || userMessage.trim();
          extractedData.subject = updatedSubject;
          extractedData.clarificationNeeded = true;
          currentState = 'INTENT_CLARIFICATION';
          activeQuickReplies = this.buildClarificationActions(
            updatedSubject,
            lead.verticalSlug,
            extractedData.suggestedActions,
          );
          assistantReply = `Got it—**${updatedSubject}**. What service do you need for **${updatedSubject}**?\n\n*(IST: ${istTimeStr})*`;
          break;
        }

        const subject = extractedData.subject || previousSubject || '';
        const actionChoice = extractedData.intent;
        const combinedIntent =
          subject && !actionChoice.toLowerCase().includes(subject.toLowerCase())
            ? `${subject} - ${actionChoice}`
            : actionChoice;

        extractedData.intent = combinedIntent;
        extractedData.clarificationNeeded = false;

        if (extractedData.locality) {
          const matchingBusinesses = await this.getMatchingVendorsForLocality(
            lead.verticalSlug,
            extractedData.locality as string,
            businesses,
          );
          if (matchingBusinesses.length > 0) {
            const uiPayload = matchingBusinesses;
            currentState = 'VENDOR_SELECTION';
            assistantReply = `Got it (**${combinedIntent}**). I found verified providers in **${extractedData.locality}**. Select a provider below:\n\n*(IST: ${istTimeStr})*`;
            lead.metadata = { state: currentState, extractedData, uiComponentType: 'VENDOR_CARDS', uiPayload, quickReplies: [] };
            await this.leadRepository.save(lead);
            await this.messageRepository.save({ sessionId, sender: 'assistant', content: assistantReply, extractedData });
            return {
              sessionId,
              reply: assistantReply,
              metadata: { state: currentState, extractedData, uiComponentType: 'VENDOR_CARDS', uiPayload, quickReplies: [] },
            };
          }
        }

        currentState = 'LOCALITY_PENDING';
        activeQuickReplies = [];
        assistantReply = `Got it (**${combinedIntent}**). Please enter your city or ZIP code where service is required:\n\n*(IST: ${istTimeStr})*`;
        break;
      }

      case 'LOCALITY_PENDING': {
        if (!extractedData.locality) {
          extractedData.locality = userMessage.trim();
        }

        const matchingBusinesses = await this.getMatchingVendorsForLocality(
          lead.verticalSlug,
          extractedData.locality as string,
          businesses,
        );

        if (matchingBusinesses.length > 0) {
          const uiPayload = matchingBusinesses;

          currentState = 'VENDOR_SELECTION';
          assistantReply = `I found verified providers for **${extractedData.intent || 'Service Request'}** in **${extractedData.locality}**. Select a provider below:\n\n*(IST: ${istTimeStr})*`;

          lead.metadata = { state: currentState, extractedData, uiComponentType: 'VENDOR_CARDS', uiPayload, quickReplies: [] };
          await this.leadRepository.save(lead);
          await this.messageRepository.save({ sessionId, sender: 'assistant', content: assistantReply, extractedData });

          return {
            sessionId,
            reply: assistantReply,
            metadata: { state: currentState, extractedData, uiComponentType: 'VENDOR_CARDS', uiPayload, quickReplies: [] },
          };
        } else {
          activeQuickReplies = [];
          assistantReply = `Our partner network is currently expanding into **${extractedData.locality}**. Please share your full name and 10-digit mobile number so our regional team can coordinate:\n\n*(IST: ${istTimeStr})*`;
          currentState = 'CONTACT_PENDING';
        }
        break;
      }

      case 'VENDOR_SELECTION': {
        const selectedVendorSummary =
          businesses.find((b) => userMessage.toLowerCase().includes(b.name.toLowerCase())) ||
          (metadata.uiPayload?.length === 1
            ? businesses.find((b) => b.id === metadata.uiPayload[0].id)
            : undefined);

        const selectedVendor = selectedVendorSummary
          ? await this.businessRepository.findOne({ where: { id: selectedVendorSummary.id } })
          : null;

        if (selectedVendor) {
          extractedData.selectedVendorId = selectedVendor.id;
          extractedData.selectedVendorName = selectedVendor.name;

          const vendorServices = await this.serviceRepository.find({
            where: { businessId: selectedVendor.id } as any,
          });

          if (vendorServices.length > 0) {
            (selectedVendor as any).services = vendorServices;
            const vertical = await this.verticalRepository.findOne({ where: { slug: lead.verticalSlug } });
            return this.processServiceOrContact(
              lead.verticalSlug,
              vertical?.name || lead.verticalSlug,
              sessionId,
              lead,
              extractedData,
              selectedVendor,
            );
          }
        }

        currentState = 'CONTACT_PENDING';
        activeQuickReplies = [];
        assistantReply = `Please share your full name and 10-digit mobile phone number so our specialist can finalize your request:\n\n*(IST: ${istTimeStr})*`;
        break;
      }

      case 'SERVICE_SELECTION': {
        extractedData.selectedService = userMessage.trim();
        currentState = 'CONTACT_PENDING';
        activeQuickReplies = [];
        assistantReply = `Great choice (**${extractedData.selectedService}**). Please share your full name and 10-digit mobile phone number so our specialist can confirm your booking:\n\n*(IST: ${istTimeStr})*`;
        break;
      }

      case 'CONTACT_PENDING': {
        activeQuickReplies = [];
        assistantReply = `Please share your full name and 10-digit mobile phone number so our specialist can finalize your request:\n\n*(IST: ${istTimeStr})*`;
        break;
      }

      default: {
        currentState = 'CONTACT_PENDING';
        activeQuickReplies = [];
        assistantReply = `Please share your full name and 10-digit mobile phone number so our specialist can finalize your request:\n\n*(IST: ${istTimeStr})*`;
        break;
      }
    }

    lead.metadata = { state: currentState, extractedData, quickReplies: activeQuickReplies };
    await this.leadRepository.save(lead);
    await this.messageRepository.save({ sessionId, sender: 'assistant', content: assistantReply });

    return {
      sessionId,
      reply: assistantReply,
      metadata: { state: currentState, extractedData, quickReplies: activeQuickReplies },
    };
  }

  async processServiceOrContact(
    verticalSlug: string,
    verticalName: string,
    sessionId: string,
    lead: Lead,
    extractedData: any,
    selectedVendor: BusinessEntity,
  ) {
    const istTimeStr = this.getIstTimestampString();
    let targetServices: ServiceEntity[] = (selectedVendor as any).services || [];
    if (extractedData.intent && String(extractedData.intent).toLowerCase().includes('repair')) {
      const filtered = targetServices.filter(
        (s: ServiceEntity) =>
          s.name.toLowerCase().includes('repair') ||
          s.name.toLowerCase().includes('servicing') ||
          s.name.toLowerCase().includes('maintenance') ||
          s.name.toLowerCase().includes('audit'),
      );
      if (filtered.length > 0) targetServices = filtered;
    }

    extractedData.availableServices = targetServices;
    const currentState = 'SERVICE_SELECTION';

    const serviceList = targetServices
      .map((s: ServiceEntity) => `• **${s.name}**${s.basePrice ? ` (₹${s.basePrice})` : ''}`)
      .join('\n');
    const responseContent = `You selected **${selectedVendor.name}** (${selectedVendor.rating || 4.5}★). Available service packages for your **${extractedData.intent || 'Service Request'}** request:\n\n${serviceList}\n\nPlease select your preferred service package:\n\n*(IST: ${istTimeStr})*`;
    const quickReplies = targetServices.map((s: ServiceEntity) => s.name);

    lead.metadata = { state: currentState, extractedData, quickReplies };
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
      messages: messages.map((m) => ({
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