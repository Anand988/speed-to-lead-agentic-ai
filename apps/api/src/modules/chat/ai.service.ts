// apps/api/src/modules/chat/ai.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openRouterApiKey: string;
  private readonly apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

  constructor(private configService: ConfigService) {
    this.openRouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
  }

  async generateChatResponse(
    history: { role: 'user' | 'assistant' | 'system'; content: string }[],
  ): Promise<{ reply: string; extractedData?: any; isQualified: boolean }> {
    try {
      const systemPrompt = {
        role: 'system',
        content: `You are an expert AI sales development representative. Your job is to converse naturally with website visitors, answer questions about our services, and organically collect their Name, Phone Number, and core Intent. 
        
        When you have gathered sufficient contact details (Name and Phone), or if the user explicitly agrees to share them, output a JSON block at the very end of your response in this exact format:
        ---EXTRACTED_DATA---
        {"name": "...", "phone": "...", "email": "...", "intent": "...", "score": 85, "qualified": true}
        ---END_EXTRACTED_DATA---
        
        Keep your conversational replies engaging, concise, and professional.`
      };

      const messages = [systemPrompt, ...history];

      const response = await axios.post(
        this.apiUrl,
        {
          model: 'deepseek/deepseek-chat', // Adjust model slug if needed
          messages: messages,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${this.openRouterApiKey}`,
            'HTTP-Referer': 'https://quantumleads.ai', // Optional OpenRouter headers
            'X-Title': 'QuantumLeads AI',
            'Content-Type': 'application/json',
          },
        },
      );

      const assistantMessage = response.data.choices[0].message.content;

      // Parse for extracted lead metadata if present
      let extractedData = null;
      let isQualified = false;
      let cleanReply = assistantMessage;

      const markerStart = '---EXTRACTED_DATA---';
      const markerEnd = '---END_EXTRACTED_DATA---';
      
      if (assistantMessage.includes(markerStart) && assistantMessage.includes(markerEnd)) {
        const startIndex = assistantMessage.indexOf(markerStart) + markerStart.length;
        const endIndex = assistantMessage.indexOf(markerEnd);
        const jsonString = assistantMessage.substring(startIndex, endIndex).trim();
        
        try {
          extractedData = JSON.parse(jsonString);
          isQualified = extractedData.qualified || false;
          // Strip the JSON block out of the conversational reply shown to the user
          cleanReply = assistantMessage.substring(0, assistantMessage.indexOf(markerStart)).trim();
        } catch (e) {
          this.logger.error('Failed to parse extracted lead JSON from AI response', e);
        }
      }

      return {
        reply: cleanReply,
        extractedData,
        isQualified,
      };
    } catch (error) {
      const errorDetails = axios.isAxiosError(error)
        ? error.response?.data || error.message
        : error instanceof Error
          ? error.message
          : String(error);
      this.logger.error('Error communicating with OpenRouter / DeepSeek API', errorDetails);
      throw new Error('AI service is temporarily unavailable. Please try again later.');
    }
  }
}