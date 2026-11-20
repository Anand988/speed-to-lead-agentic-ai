// apps/api/src/modules/chat/deepseek-extractor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { VerticalPromptService } from '../consumer-chat/vertical-prompt.service.js';
import { CANONICAL_INTENTS, normalizeIntent } from './chat-intents.constants.js';
import { ChatCacheService } from './chat-cache.service.js';

const INTENT_LIST_STR = CANONICAL_INTENTS.map((i) => `"${i}"`).join(' | ');
const INTENT_JSON_ARRAY = JSON.stringify(CANONICAL_INTENTS);
const EXTRACTION_CACHE_TTL_SECONDS = 3600;

const STATIC_EXTRACTION_RULES = `
You are a strict entity and intent extraction engine for a multi-vertical home services intake platform.
Never generate conversational prose. Return ONLY a single valid JSON object matching the schema below.

Known marketplace verticals:
- "ev-charger-setup" (EV Charger Setup)
- "home-cleaning-maintenance" (Home Cleaning & Maintenance)
- "hvac-repair-servicing" (HVAC Repair & Servicing)
- "smart-home-security-integration" (Smart Home Security Integration)
- "solar-panel-installation" (Solar Panel)

Rules:
1. VERTICAL & DOMAIN RELEVANCE CHECK (Highest Priority):
  - Compare userMessage against activeVerticalSlug.
  - If the message asks for a service/product in a DIFFERENT known vertical, set "outOfVertical": true, "suggestedVerticalName": "<matching vertical name>", "intent": null, "clarificationNeeded": false.
  - If completely unrelated to activeVerticalSlug AND all known verticals (e.g., coding, politics, sports, trivia), set "outOfVertical": true, "suggestedVerticalName": null, "intent": null, "clarificationNeeded": false.
  - Pure greetings, locality names, 10-digit phone numbers, or valid action choices MUST keep "outOfVertical": false.
2. "intent" MUST be one of: ${INTENT_LIST_STR} | null.
  - Map cleaning, deep cleaning, shampooing, sanitization, servicing, tune-ups, upkeep, and fixes to "Repair & Maintenance".
  - Map new equipment, appliance, or system setup/mounting/wiring to "Plan New Installation".
  - Map on-site inspections, surveys, audits, or quote visits to "Book Site Assessment".
3. If relevant to activeVerticalSlug (or a relevant property/unit size) and gives an underspecified noun, device, or size (e.g., "Digital camera", "4BHK", "Level 2 charger") WITHOUT a clear service action, set:
   "outOfVertical": false, "intent": null, "subject": "<noun/topic/size>", "clarificationNeeded": true, "suggestedActions": ${INTENT_JSON_ARRAY}.
4. If greeting/chitchat with no subject or action, set "outOfVertical": false, "intent": null, "subject": null, "clarificationNeeded": false, "suggestedActions": [].
5. For "locality": if the user mentions a city, neighborhood, area, or postal/ZIP code, extract it (matching exact casing from knownLocalities if present, otherwise preserving the explicitly mentioned city/area/ZIP); return null ONLY when no location is mentioned.
6. Extract "phone" only if a 10-digit number is present; otherwise null.

JSON Schema:
{
  "intent": ${INTENT_LIST_STR} | null,
  "locality": string | null,
  "requestedItem": string | null,
  "subject": string | null,
  "outOfVertical": boolean,
  "suggestedVerticalName": string | null,
  "clarificationNeeded": boolean,
  "suggestedActions": string[],
  "phone": string | null
}
`.trim();

function cleanValue(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (
    !trimmed ||
    ['none', 'n/a', 'nil', 'null', 'not specified'].includes(trimmed.toLowerCase())
  ) {
    return null;
  }
  return trimmed;
}

function cleanStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .map((item) => cleanValue(item))
    .filter((item): item is string => item !== null)
    .slice(0, 4);
}

function compactCurrentData(currentData: Record<string, any> = {}): Record<string, string> {
  const compact: Record<string, string> = {};
  for (const key of ['intent', 'locality', 'requestedItem', 'subject', 'phone']) {
    const val = cleanValue(currentData[key]);
    if (val !== null) {
      compact[key] = val;
    }
  }
  return compact;
}

function validateExtractedEntities(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const entity = value as Record<string, unknown>;
  const cleanedIntent = cleanValue(entity.intent);
  const normalizedIntent = cleanedIntent !== null ? normalizeIntent(cleanedIntent) : null;

  if (cleanedIntent !== null && normalizedIntent === null) {
    return null;
  }

  const cleanedLocality = cleanValue(entity.locality);
  const cleanedItem = cleanValue(entity.requestedItem);
  const cleanedSubject = cleanValue(entity.subject);
  const cleanedPhone = cleanValue(entity.phone);
  const outOfVertical = Boolean(entity.outOfVertical);
  const suggestedVerticalName = cleanValue(entity.suggestedVerticalName);
  const clarificationNeeded = outOfVertical ? false : Boolean(entity.clarificationNeeded);
  const suggestedActions = cleanStringArray(entity.suggestedActions);

  if (cleanedPhone !== null && !/^\d{10}$/.test(cleanedPhone)) {
    return null;
  }

  return {
    intent: outOfVertical ? null : normalizedIntent,
    locality: cleanedLocality,
    requestedItem: cleanedItem,
    subject: cleanedSubject,
    outOfVertical,
    suggestedVerticalName,
    clarificationNeeded,
    suggestedActions,
    phone: cleanedPhone,
  };
}

interface CachedExtractionDelta {
  intent: string | null;
  locality: string | null;
  requestedItem: string | null;
  subject: string | null;
  outOfVertical: boolean;
  suggestedVerticalName: string | null;
  clarificationNeeded: boolean;
  suggestedActions: string[];
  phone: string | null;
}

@Injectable()
export class DeepSeekExtractorService {
  private readonly logger = new Logger(DeepSeekExtractorService.name);
  private readonly apiKey = process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY;
  private readonly apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

  constructor(
    private readonly verticalPromptService: VerticalPromptService,
    private readonly chatCacheService: ChatCacheService,
  ) {}

  private buildExtractionCacheKey(
    verticalSlug: string,
    currentState: string,
    userMessage: string,
    compactData: Record<string, string>,
  ): string {
    const hash = this.chatCacheService.hashPayload({
      verticalSlug,
      currentState,
      normalizedMessage: userMessage.trim().toLowerCase(),
      compactData,
    });
    return `extract:${verticalSlug}:${currentState}:${hash}`;
  }

  private resolveLocality(
    rawLocality: string | null,
    fallbackLocality: string | null | undefined,
    availableLocalities: string[],
  ): string | null {
    let resolved: string | null = rawLocality ?? fallbackLocality ?? null;
    if (resolved && availableLocalities.length > 0) {
      const exactMatch = availableLocalities.find(
        (loc) => loc.toLowerCase() === resolved!.toLowerCase(),
      );
      if (exactMatch) {
        resolved = exactMatch;
      }
    }
    return resolved;
  }

  private mergeWithCurrentData(
    currentData: Record<string, any>,
    delta: CachedExtractionDelta,
    availableLocalities: string[],
  ): Record<string, any> {
    const resolvedLocality = this.resolveLocality(
      delta.locality,
      currentData.locality,
      availableLocalities,
    );

    return {
      ...currentData,
      extractionFailed: false,
      intent: delta.outOfVertical ? currentData.intent : (delta.intent ?? currentData.intent),
      locality: resolvedLocality,
      requestedItem: delta.requestedItem ?? currentData.requestedItem ?? null,
      subject: delta.outOfVertical ? currentData.subject : (delta.subject ?? currentData.subject),
      outOfVertical: delta.outOfVertical,
      suggestedVerticalName: delta.suggestedVerticalName ?? null,
      clarificationNeeded: delta.clarificationNeeded,
      suggestedActions:
        Array.isArray(delta.suggestedActions) && delta.suggestedActions.length > 0
          ? delta.suggestedActions
          : [],
      phone: delta.phone ?? currentData.phone ?? null,
    };
  }

  async extractEntities(
    verticalSlug: string,
    userMessage: string,
    availableLocalities: string[],
    currentState: string,
    currentData: any = {},
    sessionId?: string,
  ): Promise<any> {
    if (!this.apiKey) {
      this.logger.warn('OpenRouter/DeepSeek API key missing. Skipping LLM semantic extraction.');
      return currentData;
    }

    const compactData = compactCurrentData(currentData);
    const hasPhoneNumber = /\d{10}/.test(userMessage);
    const shouldUseCache = !hasPhoneNumber;
    const cacheKey = shouldUseCache
      ? this.buildExtractionCacheKey(verticalSlug, currentState, userMessage, compactData)
      : null;

    if (cacheKey) {
      const cachedDelta = await this.chatCacheService.getJson<CachedExtractionDelta>(cacheKey);
      if (cachedDelta) {
        this.logger.debug(`[Extraction Cache Hit] key="${cacheKey}"`);
        return this.mergeWithCurrentData(currentData, cachedDelta, availableLocalities);
      }
    }

    try {
      const basePrompt = await this.verticalPromptService.getPromptForVertical(verticalSlug);
      const staticSystemPrompt = basePrompt
        ? `${STATIC_EXTRACTION_RULES}\n\nVertical Context:\n${basePrompt.trim()}`
        : STATIC_EXTRACTION_RULES;

      const userPayload = JSON.stringify({
        activeVerticalSlug: verticalSlug,
        currentState,
        currentData: compactData,
        knownLocalities: availableLocalities,
        userMessage,
      });

      const payload: Record<string, unknown> = {
        model: 'deepseek/deepseek-chat',
        temperature: 0.1,
        max_tokens: 150,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: staticSystemPrompt },
          { role: 'user', content: userPayload },
        ],
      };

      if (sessionId) {
        payload.session_id = sessionId;
      }

      const response = await axios.post(this.apiUrl, payload, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Intake AI Platform',
        },
        timeout: 8000,
      });

      const usage = response.data?.usage;
      if (usage) {
        const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
        this.logger.debug(
          `[LLM Tokens] prompt=${usage.prompt_tokens ?? '?'}, cached=${cachedTokens}, completion=${usage.completion_tokens ?? '?'}`,
        );
      }

      const choice = response.data?.choices?.[0];
      const content = choice?.message?.content;

      if (!content || choice.finish_reason === 'length') {
        this.logger.warn(
          choice?.finish_reason === 'length'
            ? 'DeepSeek JSON output hit max_tokens=150 limit; marking extractionFailed.'
            : 'DeepSeek returned empty content; marking extractionFailed.',
        );
        return {
          ...currentData,
          extractionFailed: true,
          outOfVertical: false,
        };
      }

      const cleanedContent = content
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      const rawJson = JSON.parse(cleanedContent);
      const parsed = validateExtractedEntities(rawJson);

      if (!parsed) {
        this.logger.warn('LLM output failed entity validation; marking extractionFailed.');
        return {
          ...currentData,
          extractionFailed: true,
          outOfVertical: false,
        };
      }

      const delta: CachedExtractionDelta = {
        intent: (parsed.intent as string | null) ?? null,
        locality: (parsed.locality as string | null) ?? null,
        requestedItem: (parsed.requestedItem as string | null) ?? null,
        subject: (parsed.subject as string | null) ?? null,
        outOfVertical: Boolean(parsed.outOfVertical),
        suggestedVerticalName: (parsed.suggestedVerticalName as string | null) ?? null,
        clarificationNeeded: Boolean(parsed.clarificationNeeded),
        suggestedActions: Array.isArray(parsed.suggestedActions)
          ? (parsed.suggestedActions as string[])
          : [],
        phone: (parsed.phone as string | null) ?? null,
      };

      if (cacheKey && !delta.phone) {
        await this.chatCacheService.setJson(cacheKey, delta, EXTRACTION_CACHE_TTL_SECONDS);
      }

      return this.mergeWithCurrentData(currentData, delta, availableLocalities);
    } catch (error: any) {
      this.logger.error(
        'DeepSeek entity extraction failed',
        error?.response?.data ? JSON.stringify(error.response.data) : error.message,
      );
      return {
        ...currentData,
        extractionFailed: true,
        outOfVertical: false,
      };
    }
  }
}