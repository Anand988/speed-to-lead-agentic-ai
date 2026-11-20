// apps/web_intake/components/ChatWidget.tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { startChatSession, sendChatMessage } from '@/services/chatApi';

interface VendorItem {
  id: string;
  name: string;
  rating?: number;
  locality?: string;
  [key: string]: any;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    step?: string;
    stepIndex?: number;
    quote?: any;
    appointmentId?: string;
    paymentUrl?: string;
    quickReplies?: string[];
    uiComponentType?: 'LOCALITY_CHIPS' | 'VENDOR_CARDS' | 'NONE';
    uiPayload?: VendorItem[];
  };
}

interface ChatWidgetProps {
  initialVertical: string;
  initialMessage: string;
  onClose: () => void;
}

export default function ChatWidget({ initialVertical, initialMessage, onClose }: ChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  
  // Guard ref to strictly prevent duplicate session initialization on re-renders
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (initialVertical && !hasInitialized.current) {
      hasInitialized.current = true;
      initializeWidgetSession();
    }
  }, [initialVertical]);

  const initializeWidgetSession = async () => {
    setLoading(true);

    try {
      // 1. Start session and pass initialMessage to the backend for context awareness
      const startData = await startChatSession(initialVertical, initialMessage);
      const activeSessionId = startData.sessionId;
      if (activeSessionId) setConversationId(activeSessionId);

      // 2. Build initial message history: User's typed requirement first, then assistant's greeting
      const initialChatHistory: Message[] = [];

      if (initialMessage && initialMessage.trim().length > 0) {
        initialChatHistory.push({
          role: 'user',
          content: initialMessage.trim(),
        });
      }

      initialChatHistory.push({
        role: 'assistant',
        content: startData.initialMessage || `Hello! Let's get your ${initialVertical} project set up.`,
        metadata: startData.metadata,
      });

      setMessages(initialChatHistory);
    } catch (err) {
      console.error('API Error:', err);
      setMessages([{ role: 'assistant', content: 'Failed to connect to backend orchestration service.' }]);
    } finally {
      setLoading(false);
    }
  };

  const submitMessageText = async (textToSend: string) => {
    if (!textToSend.trim() || loading || !conversationId) return;

    const userMsg: Message = { role: 'user', content: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const data = await sendChatMessage(conversationId, textToSend, initialVertical);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || 'Processed successfully.',
          metadata: data.metadata,
        },
      ]);
    } catch (err) {
      console.error('API Error:', err);
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Error communicating with server.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input;
    setInput('');
    await submitMessageText(text);
  };

  return (
    <div className="w-full max-w-sm bg-[#1e293b]/90 border border-slate-700 rounded-2xl p-4 flex flex-col h-[520px] shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between pb-3 border-b border-slate-700 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Active AI Session</h3>
          <span className="text-xs text-emerald-400 font-medium">{initialVertical}</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-xs bg-slate-800 px-2 py-1 rounded-lg">
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-sm mb-3">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-emerald-600 text-white rounded-br-none'
                  : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-none'
              }`}
            >
              <p>{msg.content.replace(/\*\*/g, '')}</p>

              {/* Quick Reply Option Chips rendered dynamically */}
              {msg.metadata?.quickReplies && msg.metadata.quickReplies.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-slate-700/80">
                  {msg.metadata.quickReplies.map((option, optIdx) => (
                    <button
                      key={optIdx}
                      type="button"
                      onClick={() => submitMessageText(option)}
                      disabled={loading}
                      className="bg-slate-700 hover:bg-emerald-600 text-slate-100 text-[11px] font-medium px-2.5 py-1 rounded-lg transition disabled:opacity-50 shadow-sm"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}

              {/* Dynamic Vendor Cards Rendering */}
              {msg.metadata?.uiComponentType === 'VENDOR_CARDS' && msg.metadata.uiPayload && msg.metadata.uiPayload.length > 0 && (
                <div className="flex flex-col gap-2 mt-3 pt-2 border-t border-slate-700/80 w-full">
                  {msg.metadata.uiPayload.map((vendor) => (
                    <div 
                      key={vendor.id} 
                      className="p-3 bg-slate-900/90 border border-slate-700 rounded-xl flex flex-col justify-between shadow-sm hover:border-emerald-500/50 transition"
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-semibold text-slate-100 text-xs">{vendor.name}</span>
                        {vendor.rating && (
                          <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] px-1.5 py-0.5 rounded font-medium">
                            ★ {vendor.rating}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mb-2">Locality: {vendor.locality || 'Verified Area Partner'}</p>
                      <button
                        type="button"
                        onClick={() => submitMessageText(`Select vendor: ${vendor.name}`)}
                        disabled={loading}
                        className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold rounded-lg transition shadow-xs disabled:opacity-50"
                      >
                        Select Provider
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Payment URL Link */}
              {msg.metadata?.paymentUrl && (
                <div className="mt-2 pt-2 border-t border-slate-700">
                  <a
                    href={msg.metadata.paymentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-center bg-blue-600 hover:bg-blue-500 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition"
                  >
                    Proceed to Payment Escrow
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 border border-slate-700 text-slate-400 text-xs rounded-xl px-3 py-2 animate-pulse">
              Orchestrating workflow step...
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSendMessage} className="flex gap-2 pt-2 border-t border-slate-700">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Reply to AI assistant..."
          className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-700 bg-slate-900 text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs rounded-xl transition disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}