'use client';

import React, { useState } from 'react';

interface IntakeCardProps {
  onStartChat: (vertical: string, message: string) => void;
  disabled: boolean;
}

export default function IntakeCard({ onStartChat, disabled }: IntakeCardProps) {
  // 👉 Updated service domains/verticals
  const serviceDomains = [
    'Solar Panel Installation',
    'Home Cleaning & Maintenance',
    'EV Charger Setup',
    'HVAC Repair & Servicing',
    'Smart Home Security Integration',
  ];

  const [selectedVertical, setSelectedVertical] = useState(serviceDomains[0]);
  const [userMessage, setUserMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const defaultMsg = userMessage.trim() || `I am looking for assistance with ${selectedVertical}.`;
    onStartChat(selectedVertical, defaultMsg);
  };

  return (
    <div className="w-full max-w-md bg-[#1e293b]/60 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur">
      <div className="mb-6">
        <p className="text-xs font-semibold text-emerald-400 tracking-wider uppercase mb-1">YOUR PERSONAL AI ASSISTANT</p>
        <h2 className="text-2xl font-bold text-slate-100">Welcome! Let's get started quickly.</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          {/* 👉 Updated label text here */}
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Select a service type
          </label>
          <select
            value={selectedVertical}
            onChange={(e) => setSelectedVertical(e.target.value)}
            disabled={disabled}
            className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-slate-900 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
          >
            {serviceDomains.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Briefly describe your requirements
          </label>
          <textarea
            rows={3}
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            placeholder="e.g., Looking for a 5kW residential solar setup in Kondapur..."
            disabled={disabled}
            className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-slate-900 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={disabled}
          className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold rounded-xl shadow-lg shadow-emerald-900/20 transition duration-200 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <span>Start Chat Session</span>
          <span className="h-2 w-2 rounded-full bg-white animate-ping"></span>
        </button>
      </form>
    </div>
  );
}