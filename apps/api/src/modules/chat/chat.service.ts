// apps/api/src/modules/chat/chat.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueService } from '../queue/queue.service.js';
import { Lead, LeadStatus } from '../lead/lead.entity.js';
import { Message } from '../consumer-chat/message.entity.js';
import { VerticalEntity, VerticalMetadataConfig } from '../tenant/entities/vertical.entity.js';
import { BusinessEntity } from '../tenant/entities/business.entity.js';
import { ServiceEntity } from '../tenant/entities/service.entity.js';
import { DeepSeekExtractorService } from './deepseek-extractor.service.js';
import { VerticalPromptService } from '../consumer-chat/vertical-prompt.service.js';
import { CANONICAL_INTENTS, normalizeIntent } from './chat-intents.constants.js';
import { ChatCacheService } from './chat-cache.service.js';
import { LocalityEntity } from '../tenant/entities/locality.entity.js';

export interface CachedLocalityNode {
  name: string;
  parentCity: string;
  postalCodes: string[];
}

const VENDOR_CACHE_TTL_SECONDS = 300;
const DEFAULT_PROPERTY_SIZE_OPTIONS = [
  '1BHK',
  '2BHK',
  '3BHK',
  '4BHK',
  'Commercial / Large Property',
];

export interface CachedVendorSummary {
  id: string;
  name: string;
  rating: number;
  locality: string;
  serviceAreas: string[];
  matchType?: 'direct' | 'city_fallback';
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
    @InjectRepository(LocalityEntity)
    private readonly localityRepository: Repository<LocalityEntity>,
  ) {}

  private normalizeLocalityKey(locality: string): string {
    return locality
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async getVerticalVendorsCached(verticalSlug: string): Promise<CachedVerticalVendors> {
    const cacheKey = `vendors:${verticalSlug}:__all__`;
    const cached = await this.chatCacheService.getJson<CachedVerticalVendors>(cacheKey);
    if (cached) {
      return cached;
    }

    const [rows, localityNodes] = await Promise.all([
      this.businessRepository.find({
        where: { verticalSlug, isActive: true },
      }),
      this.getCachedLocalities(),
    ]);

    const businesses: CachedVendorSummary[] = rows.map((b) => ({
      id: b.id,
      name: b.name,
      rating: Number(b.rating) || 4.5,
      locality: b.locality,
      serviceAreas: Array.isArray(b.serviceAreas) ? b.serviceAreas : [],
    }));

    const localities = Array.from(
      new Set([
        ...businesses.map((b) => b.locality).filter(Boolean),
        ...businesses.flatMap((b) => b.serviceAreas).filter(Boolean),
        ...localityNodes.map((n) => n.name).filter(Boolean),
      ]),
    );

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

    const dbLocalityNodes = await this.getCachedLocalities();
    const scored: Array<{ vendor: CachedVendorSummary; rank: number }> = [];

    for (const b of allBusinesses) {
      const matchType = this.classifyLocalityMatch(b, targetLocality, dbLocalityNodes);
      if (!matchType) continue;

      scored.push({
        vendor: {
          id: b.id,
          name: b.name,
          rating: Number(b.rating) || 4.5,
          locality: b.locality,
          serviceAreas: b.serviceAreas || [],
          matchType,
        },
        rank: matchType === 'direct' ? 0 : 1,
      });
    }

    scored.sort((a, b) => a.rank - b.rank || (b.vendor.rating || 0) - (a.vendor.rating || 0));
    const matching = scored.map((item) => item.vendor);

    await this.chatCacheService.setJson(cacheKey, matching, VENDOR_CACHE_TTL_SECONDS);
    return matching;
  }

  private classifyLocalityMatch(
    business: CachedVendorSummary,
    targetLocality: string,
    dbLocalityNodes: CachedLocalityNode[],
  ): 'direct' | 'city_fallback' | null {
    const resolved = this.resolveLocationFromDb(targetLocality, dbLocalityNodes);
    if (!resolved.normalizedInput) return null;

    const bizAreas = [business.locality, ...(business.serviceAreas || [])]
      .map((a) => this.normalizeLocalityKey(a))
      .filter(Boolean);

    if (bizAreas.length === 0) return null;

    const directCandidates = Array.from(
      new Set([resolved.normalizedInput, resolved.resolvedName].filter((v): v is string => Boolean(v))),
    );

    const isDirectMatch = bizAreas.some((area) =>
      directCandidates.some(
        (cand) => area === cand || area.includes(cand) || cand.includes(area),
      ),
    );
    if (isDirectMatch) {
      return 'direct';
    }

    if (resolved.parentCity) {
      const isCityFallback = bizAreas.some((area) => area === resolved.parentCity);
      if (isCityFallback) {
        return 'city_fallback';
      }
    }

    return null;
  }

  async invalidateVendorCache(verticalSlug: string): Promise<number> {
    return this.chatCacheService.delByPrefix(`vendors:${verticalSlug}:`);
  }

  async invalidateLocalityCache(): Promise<number> {
    const deletedLocalities = await this.chatCacheService.delByPrefix('localities:');
    const deletedVendors = await this.chatCacheService.delByPrefix('vendors:');
    return deletedLocalities + deletedVendors;
  }

  private matchDeterministicInput(
    userMessage: string,
    currentState: string,
    dbLocalities: string[],
    currentData: any,
    metadata?: VerticalMetadataConfig | null,
  ): { handled: boolean; data: any } {
    const trimmed = userMessage.trim();
    const lower = trimmed.toLowerCase();

    // 1. Late states never need LLM extraction
    if (['VENDOR_SELECTION', 'SERVICE_SELECTION', 'CONTACT_PENDING'].includes(currentState)) {
      return { handled: true, data: currentData };
    }

    // 2. Simple greeting or unrealistic property size (when enabled for vertical)
    if (this.isSimpleGreeting(trimmed) || this.getUnrealisticPropertySizeValue(trimmed, metadata) !== null) {
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

    // 3. Exact match on vertical-configured or baseline intent / quick-reply
    const mappedIntent = normalizeIntent(trimmed, metadata);
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

    // 3b. Deterministic match on DB-configured clarificationSubjects (e.g., "sofa", "carpet")
    const subjects = metadata?.clarificationSubjects;
    if (Array.isArray(subjects) && subjects.length > 0) {
      const matchedSubject = subjects.find(
        (s) => s.trim().toLowerCase() === lower,
      );
      if (matchedSubject) {
        return {
          handled: true,
          data: {
            ...currentData,
            subject: trimmed,
            clarificationNeeded: true,
            outOfVertical: false,
            extractionFailed: false,
          },
        };
      }
    }

    // 3c. Deterministic match when user clicks a rendered clarificationActionTemplate chip
    const templates = metadata?.clarificationActionTemplates;
    if (Array.isArray(templates) && templates.length > 0) {
      const subjectForTpl = String(currentData?.subject || '').trim();
      const renderedActions = templates
        .map((tpl) => tpl.replace(/\{subject\}/gi, subjectForTpl || 'this item').trim().toLowerCase())
        .filter(Boolean);

      if (renderedActions.includes(lower)) {
        return {
          handled: true,
          data: {
            ...currentData,
            intent: trimmed,
            clarificationNeeded: false,
            outOfVertical: false,
            extractionFailed: false,
          },
        };
      }
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

  private getUnrealisticPropertySizeValue(
    input: string | null | undefined,
    metadata?: VerticalMetadataConfig | null,
  ): number | null {
    const propConfig = metadata?.propertySizeConfig;
    if (propConfig && propConfig.enabled === false) return null;
    if (!input) return null;

    const match = input.trim().match(/^(\d+)\s*bhk$/i);
    if (!match) return null;
    const count = Number(match[1]);
    const maxUnits = typeof propConfig?.maxUnits === 'number' && Number.isFinite(propConfig.maxUnits)
      ? propConfig.maxUnits
      : 10;
    return Number.isFinite(count) && count > maxUnits ? count : null;
  }

  private getPropertySizeOptions(metadata?: VerticalMetadataConfig | null): string[] {
    const configured = metadata?.propertySizeConfig?.options;
    if (Array.isArray(configured) && configured.length > 0) {
      return configured.map((o) => String(o).trim()).filter(Boolean);
    }
    return [...DEFAULT_PROPERTY_SIZE_OPTIONS];
  }

  private buildClarificationActions(
    subject: string,
    metadata?: VerticalMetadataConfig | null,
    suggested?: unknown,
  ): string[] {
    if (Array.isArray(suggested) && suggested.length > 0) {
      return suggested.map((item) => String(item).trim()).filter(Boolean).slice(0, 4);
    }
    const cleanSubject = subject.trim() || 'this item';
    const templates = metadata?.clarificationActionTemplates;
    if (Array.isArray(templates) && templates.length > 0) {
      return templates
        .map((tpl) => tpl.replace(/\{subject\}/gi, cleanSubject).trim())
        .filter(Boolean)
        .slice(0, 4);
    }
    if (Array.isArray(metadata?.canonicalIntents) && metadata.canonicalIntents.length > 0) {
      return [...metadata.canonicalIntents];
    }
    return [...CANONICAL_INTENTS];
  }

  private formatExpansionReply(
    locality: string,
    metadata: VerticalMetadataConfig | null | undefined,
    istTimeStr: string,
  ): string {
    const template = metadata?.expansionReplyTemplate;
    if (template && template.trim().length > 0) {
      return `${template.replace(/\{locality\}/gi, `**${locality}**`)}\n\n*(IST: ${istTimeStr})*`;
    }
    return `Our network is expanding into **${locality}**. Please share your full name and 10-digit mobile phone number so our regional team can coordinate:\n\n*(IST: ${istTimeStr})*`;
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

    const [{ businesses, localities: dbLocalities }, vertical] = await Promise.all([
      this.getVerticalVendorsCached(verticalSlug),
      this.getVerticalCached(verticalSlug),
    ]);

    const verticalMeta = vertical?.metadata ?? null;
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
          verticalMeta,
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

          if (
            !extractedData.extractionFailed &&
            !extractedData.outOfVertical &&
            !extractedData.intent &&
            !extractedData.clarificationNeeded &&
            !this.isSimpleGreeting(cleanedInitialMsg) &&
            this.getUnrealisticPropertySizeValue(cleanedInitialMsg, verticalMeta) === null
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
    const unrealisticBhk = this.getUnrealisticPropertySizeValue(
      clarificationSubject || cleanedInitialMsg,
      verticalMeta,
    );

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
        initialGreeting = this.formatExpansionReply(
          extractedData.locality as string,
          verticalMeta,
          istTimeStr,
        );
      }
    } else if (extractedData.intent) {
      initialState = 'LOCALITY_PENDING';
      quickReplies = [];
      initialGreeting = `Understood (**${extractedData.intent}**). Please enter your city or ZIP code where service is required:\n\n*(IST: ${istTimeStr})*`;
    } else if (unrealisticBhk !== null) {
      extractedData.subject = null;
      extractedData.clarificationNeeded = true;
      initialState = 'INTENT_CLARIFICATION';
      quickReplies = this.getPropertySizeOptions(verticalMeta);
      initialGreeting = `**${unrealisticBhk}BHK** doesn't look like a standard residential layout—did you mean a standard home size like **1BHK–4BHK**, or are you looking for commercial / large-property service?\n\n*(IST: ${istTimeStr})*`;
    } else if (extractedData.clarificationNeeded && clarificationSubject) {
      extractedData.subject = clarificationSubject;
      initialState = 'INTENT_CLARIFICATION';
      quickReplies = this.buildClarificationActions(
        clarificationSubject,
        verticalMeta,
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

    const [{ businesses, localities: dbLocalities }, vertical] = await Promise.all([
      this.getVerticalVendorsCached(lead.verticalSlug),
      this.getVerticalCached(lead.verticalSlug),
    ]);
    const verticalMeta = vertical?.metadata ?? null;
    const verticalName = vertical?.name || lead.verticalSlug.replace(/-/g, ' ');

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
        verticalMeta,
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
            this.getUnrealisticPropertySizeValue(userMessage, verticalMeta) === null)
        ) {
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
        const unrealisticBhk = this.getUnrealisticPropertySizeValue(
          clarificationSubject || userMessage,
          verticalMeta,
        );

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
          activeQuickReplies = this.getPropertySizeOptions(verticalMeta);
          assistantReply = `**${unrealisticBhk}BHK** doesn't look like a standard residential layout—did you mean a standard home size like **1BHK–4BHK**, or are you looking for commercial / large-property service?\n\n*(IST: ${istTimeStr})*`;
          break;
        }

        if (extractedData.clarificationNeeded && clarificationSubject) {
          extractedData.subject = clarificationSubject;
          currentState = 'INTENT_CLARIFICATION';
          activeQuickReplies = this.buildClarificationActions(
            clarificationSubject,
            verticalMeta,
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
          currentState = 'GREETING';
          activeQuickReplies = await this.verticalPromptService.getQuickRepliesForVertical(lead.verticalSlug);
          assistantReply = `I'm experiencing a brief connection hiccup while processing **"${userMessage.trim()}"**. Please pick one of the **${verticalName}** options below or try again in a moment:\n\n*(IST: ${istTimeStr})*`;
          break;
        }

        if (extractedData.outOfVertical) {
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

        const unrealisticBhk = this.getUnrealisticPropertySizeValue(userMessage, verticalMeta);
        if (unrealisticBhk !== null) {
          extractedData.subject = null;
          currentState = 'INTENT_CLARIFICATION';
          activeQuickReplies = this.getPropertySizeOptions(verticalMeta);
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
            verticalMeta,
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
          assistantReply = this.formatExpansionReply(
            extractedData.locality as string,
            verticalMeta,
            istTimeStr,
          );
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
            return this.processServiceOrContact(
              lead.verticalSlug,
              verticalName,
              sessionId,
              lead,
              extractedData,
              selectedVendor,
              verticalMeta,
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
    verticalMeta?: VerticalMetadataConfig | null,
  ) {
    const istTimeStr = this.getIstTimestampString();
    let targetServices: ServiceEntity[] = (selectedVendor as any).services || [];
    const intentLower = String(extractedData.intent || '').toLowerCase();

    const configuredKeywords = verticalMeta?.serviceFilterKeywords;
    if (configuredKeywords && typeof configuredKeywords === 'object') {
      for (const [bucketKey, keywords] of Object.entries(configuredKeywords)) {
        if (intentLower.includes(bucketKey.toLowerCase()) && Array.isArray(keywords) && keywords.length > 0) {
          const lowerKeywords = keywords.map((k) => String(k).toLowerCase());
          const filtered = targetServices.filter((s: ServiceEntity) =>
            lowerKeywords.some((kw) => s.name.toLowerCase().includes(kw)),
          );
          if (filtered.length > 0) {
            targetServices = filtered;
          }
          break;
        }
      }
    } else if (intentLower.includes('repair')) {
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

  private async getCachedLocalities(): Promise<CachedLocalityNode[]> {
    const cacheKey = 'localities:__all__';
    const cached = await this.chatCacheService.getJson<CachedLocalityNode[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const rows = await this.localityRepository.find({
      where: { isActive: true },
    });

    const nodes: CachedLocalityNode[] = rows.map((row) => ({
      name: row.name,
      parentCity: row.parentCity,
      postalCodes: Array.isArray(row.postalCodes) ? row.postalCodes : [],
    }));

    await this.chatCacheService.setJson(cacheKey, nodes, VENDOR_CACHE_TTL_SECONDS);
    return nodes;
  }

  private resolveLocationFromDb(
    rawInput: string,
    dbLocalityNodes: CachedLocalityNode[],
  ): { normalizedInput: string; resolvedName: string | null; parentCity: string | null } {
    const normalizedInput = this.normalizeLocalityKey(rawInput);
    if (!normalizedInput) {
      return { normalizedInput: '', resolvedName: null, parentCity: null };
    }

    const primarySegment = normalizedInput.split(',')[0].trim();

    for (const node of dbLocalityNodes) {
      const normName = this.normalizeLocalityKey(node.name);
      const normParent = this.normalizeLocalityKey(node.parentCity);
      const normPincodes = node.postalCodes.map((p) => this.normalizeLocalityKey(p));

      if (
        normName === normalizedInput ||
        normName === primarySegment ||
        normPincodes.includes(normalizedInput) ||
        normPincodes.includes(primarySegment)
      ) {
        return {
          normalizedInput,
          resolvedName: normName,
          parentCity: normParent || normName,
        };
      }
    }

    const matchingParent = dbLocalityNodes.find(
      (node) =>
        this.normalizeLocalityKey(node.parentCity) === normalizedInput ||
        this.normalizeLocalityKey(node.parentCity) === primarySegment,
    );

    if (matchingParent) {
      const normParent = this.normalizeLocalityKey(matchingParent.parentCity);
      return {
        normalizedInput,
        resolvedName: normParent,
        parentCity: normParent,
      };
    }

    return {
      normalizedInput,
      resolvedName: primarySegment,
      parentCity: null,
    };
  }

  private async getVerticalCached(verticalSlug: string): Promise<VerticalEntity | null> {
    const cacheKey = `vertical:${verticalSlug}`;
    const cached = await this.chatCacheService.getJson<VerticalEntity>(cacheKey);
    if (cached) {
      return cached;
    }

    const vertical = await this.verticalRepository.findOne({ where: { slug: verticalSlug } });
    if (vertical) {
      await this.chatCacheService.setJson(cacheKey, vertical, VENDOR_CACHE_TTL_SECONDS);
    }
    return vertical;
  }

  async invalidateVerticalCache(verticalSlug: string): Promise<number> {
    return this.chatCacheService.delByPrefix(`vertical:${verticalSlug}`);
  }
}