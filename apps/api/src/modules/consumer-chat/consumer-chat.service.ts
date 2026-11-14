// apps/api/src/modules/consumer-chat/consumer-chat.service.ts
import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { VerticalPromptService } from './vertical-prompt.service.js';
import { QueueService } from '../queue/queue.service.js';
import { Lead, LeadStatus } from '../lead/lead.entity.js';
import { Message } from './message.entity.js';

@Injectable()
export class ConsumerChatService {
  private readonly logger = new Logger(ConsumerChatService.name);
  private readonly openRouterApiKey: string;
  private readonly openRouterApiUrl = 'https://openrouter.ai/api/v1/chat/completions';

  constructor(
    private readonly configService: ConfigService,
    private readonly verticalPromptService: VerticalPromptService,
    private readonly queueService: QueueService,
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {
    this.openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
  }

  async startSession(verticalSlug: string) {
    const systemPrompt = this.verticalPromptService.getPromptForVertical(verticalSlug);
    const sessionId = `visitor_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Persist system session start message
    await this.messageRepository.save({
      sessionId,
      sender: 'system',
      content: `Session started for vertical: ${verticalSlug}`,
    });

    this.logger.log(`Started new secure session: ${sessionId} for vertical: ${verticalSlug}`);

    return {
      sessionId,
      verticalSlug,
      systemPromptLoaded: !!systemPrompt,
      initialMessage: `Hello! I'm your virtual assistant for ${verticalSlug}. How can I assist you with your requirements today?`,
    };
  }

  async processMessage(sessionId: string, verticalSlug: string, userMessage: string) {
    // --- L3 SECURITY LAYER: Heuristic Threat & Prompt Injection Screening ---
    this.screenMessageForThreats(userMessage);

    // 1. Persist incoming visitor message
    await this.messageRepository.save({
      sessionId,
      sender: 'visitor',
      content: userMessage,
    });

    // --- L4 SECURITY LAYER: Vertical Prompt & Guardrails ---
    const baseSystemPrompt = this.verticalPromptService.getPromptForVertical(verticalSlug);

    const systemPrompt = `${baseSystemPrompt}
    
    CRITICAL INSTRUCTION: You must respond strictly in valid JSON format with the following keys:
    {
      "reply": "Your conversational response to the user here",
      "isQualified": boolean (true ONLY if the user has provided their location/zip code, exact scope, and contact readiness),
      "extractedData": {
        "name": "extracted name or null",
        "phone": "extracted phone or null",
        "email": "extracted email or null",
        "location": "extracted zip code or city or null",
        "requirements": "summary of requirements or null"
      }
    }`;

    try {
      const aiResponseJson = await this.callOpenRouterAI(systemPrompt, userMessage);
      
      let parsedResponse;
      try {
        const cleanJsonString = aiResponseJson.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedResponse = JSON.parse(cleanJsonString);
      } catch (parseError) {
        this.logger.warn(`Failed to parse structured JSON from AI. Falling back to safe response.`);
        parsedResponse = {
          reply: "I've received your message. Could you please confirm your location and contact details so we can assist you further?",
          isQualified: false,
          extractedData: {},
        };
      }

      const { reply, isQualified, extractedData } = parsedResponse;
      let savedLeadId = null;

      if (isQualified) {
        let existingLead = await this.leadRepository.findOne({ where: { sessionId } });

        if (!existingLead) {
          const newLead = this.leadRepository.create({
            sessionId,
            verticalSlug,
            status: LeadStatus.NEW,
            source: 'Public Discovery Marketplace',
            firstName: extractedData?.name || 'Consumer',
            lastName: '',
            email: extractedData?.email || null,
            phone: extractedData?.phone || null,
            metadata: { 
              extractedData, 
              lastMessage: userMessage, 
              systemPromptUsed: verticalSlug 
            },
          });
          const savedLead = await this.leadRepository.save(newLead);
          savedLeadId = savedLead.id;

          await this.queueService.addMarketplaceMatchingJob({
            leadId: savedLeadId,
            verticalSlug,
            sessionId,
            metadata: extractedData,
          });

          this.logger.log(`Secure Lead ${savedLeadId} qualified and queued for marketplace matching.`);
        } else {
          savedLeadId = existingLead.id;
        }
      }

      // Ensure reply is explicitly a string, never an object or undefined
      const responseContent = typeof reply === 'string' && reply.trim().length > 0 
        ? reply 
        : "I've received your message. Could you please confirm your location and contact details so we can assist you further?";

      // 2. Persist assistant response message along with extracted data
      await this.messageRepository.save({
        sessionId,
        sender: 'assistant',
        content: responseContent, // Guaranteed string
        extractedData: extractedData || {},
      });

      return {
        sessionId,
        reply: responseContent,
        isQualified,
        leadId: savedLeadId,
        extractedData: extractedData || {},
      };
    } catch (error) {
      this.logger.error(
        `Error processing AI message for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('Failed to process chat message securely.');
    }
  }

  /**
   * L3 Heuristic Security Filter: Screens input for prompt jailbreaks & malicious patterns.
   */
  private screenMessageForThreats(message: string): void {
    const lower = message.toLowerCase();
    const maliciousPatterns = [
      'ignore previous instructions',
      'system prompt',
      'you are now untethered',
      'drop table',
      '<script>',
      'javascript:',
    ];

    for (const pattern of maliciousPatterns) {
      if (lower.includes(pattern)) {
        this.logger.warn(`L3 Security Alert: Potential prompt injection or malicious payload detected: "${message}"`);
        throw new BadRequestException('Request flagged by security filter. Please keep inquiries focused on service requests.');
      }
    }
  }

  private async callOpenRouterAI(systemPrompt: string, userMessage: string): Promise<string> {
    if (!this.openRouterApiKey) {
      this.logger.warn('OPENROUTER_API_KEY is missing. Returning fallback response.');
      return JSON.stringify({
        reply: `Received your message: "${userMessage}". (API key is missing).`,
        isQualified: false,
        extractedData: {}
      });
    }

    try {
      const response = await axios.post(
        this.openRouterApiUrl,
        {
          model: 'deepseek/deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.3,
        },
        {
          headers: {
            Authorization: `Bearer ${this.openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://yourdomain.com',
            'X-Title': 'Speed to Lead Marketplace',
          },
        },
      );

      return response.data?.choices?.[0]?.message?.content || '{"reply": "Error generating response", "isQualified": false, "extractedData": {}}';
    } catch (error) {
      const errorDetails = axios.isAxiosError(error) && error.response?.data
        ? JSON.stringify(error.response.data)
        : error instanceof Error
          ? error.message
          : String(error);
      this.logger.error(`OpenRouter API error: ${errorDetails}`);
      throw error;
    }
  }
}