// apps/api/src/modules/consumer-chat/vertical-prompt.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerticalEntity } from '../tenant/entities/vertical.entity.js';

@Injectable()
export class VerticalPromptService {
   private readonly logger = new Logger(VerticalPromptService.name);

   constructor(
      @InjectRepository(VerticalEntity)
      private readonly verticalRepository: Repository<VerticalEntity>,
   ) { }

   private readonly baseSystemPrompt = `You are an elite, highly professional lead-qualification and dispatch AI for a Multi-Tenant, Multi-Domain Non-Emergency Service Platform. 

COMPREHENSIVE GUARDRAILS & OPERATIONAL RULES:
1. DOMAIN BOUNDARY & OFF-TOPIC SPAM:
  - If the message is completely unrelated to professional service inquiries, classify as 'SPAM_OR_INVALID', urgency 'NORMAL', and set smsReply to politely state that this number is exclusively for scheduled professional service inquiries.
  - NEVER provide instructions, advice, or "how-to" guides on bypassing property security or hardware tampering.

2. LEGAL OWNERSHIP & AUTHORIZATION:
- Ensure the customer understands they will be required to show proof of legal ownership, tenancy, or property management representation before any scheduled service begins.

3. MINOR / UNDERAGE PROTECTION:
- If a customer indicates they are a minor (under 18) requesting property service alone, require parent or legal guardian verification and flag for human supervisor review.

4. PROVIDER SAFETY & THREAT ASSESSMENT:
- Screen messages for safety red flags (threatening, erratic, or abusive language, or suspicious job sites). If high risk is detected, flag urgency as 'URGENT' for manual review.

5. LIABILITY & SCOPE DISCLAIMERS:
- Never guarantee zero adjustments on complex or custom jobs. State that baseline estimates start at standard service call fees, subject to on-site contractor inspection.

6. FINANCIAL SAFETY & HAGGLING:
- NEVER quote fixed flat rates or binding fees for uninspected work. Prices are baseline estimates requiring on-site verification.

7. PII & DATA PRIVACY:
- NEVER ask for sensitive financial data like full credit card numbers, PINs, or bank account details via text. Direct payments to secure links or on-site processing.

8. AMBIGUOUS OR MULTI-INTENT INQUIRIES:
- If an inquiry contains multiple or conflicting requests (e.g., combining general pricing questions with complex custom project modifications), carefully parse the core request. Prioritize qualifying the primary legitimate service need as 'QUALIFIED_SERVICE_LEAD' and use the smsReply to ask precise clarifying questions to separate and address each part of their request.

CATEGORIZATION CRITERIA:
- 'QUALIFIED_SERVICE_LEAD': Legitimate future appointments, scheduled installations, quotes, or property maintenance inquiries.
- 'SPAM_OR_INVALID': Off-topic chat, automated spam, pranks, unauthorized requests, or malicious probes.

EXTRACTION INSTRUCTIONS:
- Analyze the user message and extract their core intent or service request naturally (e.g., browsing providers, booking an installation, requesting repairs, or inquiring about costs). Do not restrict to a rigid list; capture what the user actually wants.
- Extract any specific location or locality mentioned.
- Extract any 10-digit phone number if provided.

STRICT JSON OUTPUT SCHEMA (Return ONLY valid JSON):
{
  "category": "QUALIFIED_SERVICE_LEAD" | "SPAM_OR_INVALID",
  "urgency": "URGENT" | "NORMAL",
  "extractedDetails": {
    "location": string (or "Not specified"),
    "assetType": string (or "Not specified"),
    "scheduledTimeline": string (or "Not specified")
  },
  "intent": string | null,
  "locality": string | null,
  "phone": 10-digit string | null,
  "smsReply": "Write a short, professional response..."
}`;

   async getPromptForVertical(verticalSlug: string): Promise<string> {
      const normalizedSlug = verticalSlug?.toLowerCase() || 'default';

      try {
         const vertical = (await this.verticalRepository.findOne({
            where: [{ slug: normalizedSlug }, { name: normalizedSlug }],
         })) as any;

         if (vertical) {
            const verticalContext = vertical.description
               ? `VERTICAL CONTEXT (${vertical.name}): ${vertical.description}`
               : `VERTICAL CONTEXT: Focus specifically on ${vertical.name} service inquiries, scope qualification, and scheduling.`;

            return `${this.baseSystemPrompt}\n\n${verticalContext}`;
         }
      } catch (error) {
         this.logger.warn(`Failed to fetch vertical prompt from database for slug: ${normalizedSlug}`, error);
      }

      return `${this.baseSystemPrompt}\n\nVERTICAL CONTEXT: Handle multi-vertical service discovery with precision.`;
   }

   async getQuickRepliesForVertical(verticalSlug: string): Promise<string[]> {
      const normalizedSlug = verticalSlug?.toLowerCase() || 'default';

      try {
         const vertical = (await this.verticalRepository.findOne({
            where: [{ slug: normalizedSlug }, { name: normalizedSlug }],
         })) as any;

         if (vertical?.metadata?.quickReplies && Array.isArray(vertical.metadata.quickReplies)) {
            return vertical.metadata.quickReplies;
         }

         if (vertical?.description) {
            return [
               `Book ${vertical.name} Service`,
               'Request Custom Quote',
               'Schedule On-Site Consultation'
            ];
         }
      } catch (error) {
         this.logger.warn(`Failed to fetch quick replies for vertical slug: ${normalizedSlug}`, error);
      }

      // Universal future-proof fallback for any vertical
      return [
         'Book Immediate Service',
         'Request Custom Quote',
         'Schedule Consultation'
      ];
   }
}