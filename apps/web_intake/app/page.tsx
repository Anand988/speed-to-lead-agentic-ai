// apps/web_intake/app/page.tsx
'use client';

import React, { useState } from 'react';
import IntakeCard from '@/components/IntakeCard';
import ChatWidget from '@/components/ChatWidget';
import Navbar from '@/components/Navbar';

export default function IntakeDashboardPage() {
  const [chatActive, setChatActive] = useState(false);
  const [chatData, setChatData] = useState({ vertical: 'Service Inquiry', message: '' });

  const handleStartChat = (vertical: string, message: string) => {
    setChatData({ vertical, message });
    setChatActive(true);
  };

  return (
    <div className="min-h-screen bg-[#111827] text-slate-100 flex flex-col font-sans">
      {/* Navbar Component */}
      <Navbar />

      {/* Main Content Area - Side-by-Side Layout */}
      <main className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center justify-items-center">
          
          {/* Left Column: Intake Card */}
          <div className="w-full lg:col-span-7 flex justify-center">
            <IntakeCard onStartChat={handleStartChat} disabled={chatActive} />
          </div>

          {/* Right Column: Live Chat Widget */}
          <div className="w-full lg:col-span-5 flex justify-center">
            {chatActive ? (
              <ChatWidget 
                initialVertical={chatData.vertical} 
                initialMessage={chatData.message}
                onClose={() => setChatActive(false)}
              />
            ) : (
              <div className="w-full max-w-sm bg-[#1e293b]/40 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 flex flex-col items-center justify-center h-[520px] backdrop-blur">
                <div className="h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center text-xl mb-4">
                  💬
                </div>
                <p className="text-sm font-medium text-slate-300 mb-1">Chat Widget Inactive</p>
                <p className="text-xs text-slate-500">
                  Fill out the intake form and click "Start Chat Session" to launch the active conversation connected to your NestJS backend.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}