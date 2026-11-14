// apps/web_intake/components/ChatWidget.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { startChatSession, sendChatMessage } from '@/services/chatApi';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    step?: string;
    quote?: any;
    appointmentId?: string;
    paymentUrl?: string;
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

  useEffect(() => {
    if (initialMessage) {
      handleInitialSubmission(initialMessage);
    }
  }, [initialMessage]);

  const handleInitialSubmission = async (text: string) => {
    const userMsg: Message = { role: 'user', content: text };
    setMessages([userMsg]);
    setLoading(true);

    try {
      // 1. Start Session dynamically via API service
      const startData = await startChatSession(initialVertical);
      const activeSessionId = startData.sessionId;
      if (activeSessionId) setConversationId(activeSessionId);

      // 2. Send Initial Message dynamically
      const data = await sendChatMessage(activeSessionId, text, initialVertical);

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
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Failed to connect to backend orchestration service.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading || !conversationId) return;

    const userText = input;
    setInput('');
    const userMsg: Message = { role: 'user', content: userText };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const data = await sendChatMessage(conversationId, userText, initialVertical);
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
              {/* Clean up raw markdown asterisks for polished UI presentation */}
              <p>{msg.content.replace(/\*\*/g, '')}</p>

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
              Orchestrating vendors & pricing...
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