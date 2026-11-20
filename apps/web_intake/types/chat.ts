// apps/web_intake/types/chat.ts

export interface QuoteDetails {
  baseRate: number;
  estimatedTotal: number;
  currency: string;
}

export interface VendorItem {
  id: string;
  name: string;
  rating?: number;
  locality?: string;
  [key: string]: any;
}

export interface ChatMetadata {
  paymentUrl?: string;
  appointmentId?: string;
  quote?: QuoteDetails;
  quickReplies?: string[];
  uiComponentType?: 'LOCALITY_CHIPS' | 'VENDOR_CARDS' | 'NONE';
  uiPayload?: VendorItem[];
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
  initialMessage?: string;
  metadata?: ChatMetadata;
}

export interface ChatMessageResponse {
  reply: string;
  conversationId: string;
  metadata?: ChatMetadata;
}