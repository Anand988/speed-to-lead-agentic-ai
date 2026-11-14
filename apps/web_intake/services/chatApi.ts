// web_intake/services/chatApi.ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export async function startChatSession(verticalSlug: string, tenantId?: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/consumer/chat/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      verticalSlug, 
      tenantId: tenantId || process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID 
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    console.error('Start chat error response:', errData);
    throw new Error('Failed to start chat session');
  }

  return response.json();
}

export async function sendChatMessage(sessionId: string, message: string, verticalSlug: string, tenantId?: string) {
  const response = await fetch(`${API_BASE_URL}/api/v1/consumer/chat/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      sessionId, 
      message, 
      verticalSlug, 
      tenantId: tenantId || process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID 
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    console.error('Send message error response:', errData);
    throw new Error('Failed to send message');
  }

  return response.json();
}