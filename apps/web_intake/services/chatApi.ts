// apps/web_intake/services/chatApi.ts
const API_BASE = 'http://localhost:3000/api/v1/consumer/chat';

export async function startChatSession(verticalSlug: string, initialMessage?: string) {
  const response = await fetch(`${API_BASE}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      verticalSlug, 
      initialMessage: initialMessage || undefined 
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    console.error('Start chat error response:', errData);
    throw new Error('Failed to start consumer chat session');
  }

  return response.json();
}

export async function sendChatMessage(sessionId: string, message: string, verticalSlug: string) {
  const response = await fetch(`${API_BASE}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      message,
      verticalSlug,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    console.error('Send message error response:', errData);
    throw new Error('Failed to send consumer chat message');
  }

  return response.json();
}