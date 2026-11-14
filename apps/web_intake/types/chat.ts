// apps/web_intake/types/chat.ts

export interface QuoteDetails {
  baseRate: number;
  estimatedTotal: number;
  currency: string;
}

export interface ChatMetadata {
  paymentUrl?: string;
  appointmentId?: string;
  quote?: QuoteDetails;
}

export interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  metadata?: ChatMetadata;
}

export interface ChatSessionResponse {
  sessionId: string;
  status: string;
}

export interface ChatMessageResponse {
  reply: string;
  conversationId: string;
  metadata?: ChatMetadata;
}