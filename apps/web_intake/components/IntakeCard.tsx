// components/IntakeCard.tsx
'use client';

import React, { useState, useEffect } from 'react';

interface IntakeCardProps {
  onStartChat: (vertical: string, message: string) => void;
  disabled: boolean;
}

interface Vertical {
  id: string;
  slug: string;
  name: string;
  metadata?: {
    requirementPlaceholder?: string;
  };
}

const getRequirementPlaceholder = (
  vertical?: Vertical,
  locality?: string,
): string => {
  const area = locality?.trim() || 'your area';

  if (vertical?.metadata?.requirementPlaceholder) {
    return vertical.metadata.requirementPlaceholder.replace('{locality}', area);
  }

  const label = vertical?.name?.trim() || vertical?.slug?.replace(/-/g, ' ') || 'service';
  return `Describe your ${label} requirement in ${area}...`;
};

export default function IntakeCard({ onStartChat, disabled }: IntakeCardProps) {
  const [serviceDomains, setServiceDomains] = useState<Vertical[]>([]);
  const [selectedVerticalSlug, setSelectedVerticalSlug] = useState<string>('');
  const [userMessage, setUserMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchVerticals() {
      try {
        const res = await fetch('http://localhost:3000/api/verticals');

        if (res.ok) {
          const data = await res.json();
          const verticals: Vertical[] = Array.isArray(data) ? data : data.verticals || [];
          setServiceDomains(verticals);
          if (verticals.length > 0) {
            setSelectedVerticalSlug(verticals[0].slug);
          }
        }
      } catch (err) {
        console.error('Failed to fetch verticals from database', err);
      } finally {
        setLoading(false);
      }
    }
    fetchVerticals();
  }, []);

  const activeDomain = serviceDomains.find((d) => d.slug === selectedVerticalSlug);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const verticalLabel = activeDomain?.name || selectedVerticalSlug;
    const defaultMsg = userMessage.trim() || `I am looking for assistance with ${verticalLabel}.`;
    onStartChat(selectedVerticalSlug || verticalLabel, defaultMsg);
  };

  return (
    <div className="w-full max-w-md bg-[#1e293b]/60 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur">
      <div className="mb-6">
        <p className="text-xs font-semibold text-emerald-400 tracking-wider uppercase mb-1">
          YOUR PERSONAL AI ASSISTANT
        </p>
        <h2 className="text-2xl font-bold text-slate-100">Welcome! Let&apos;s get started quickly.</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Select a service type
          </label>
          <select
            value={selectedVerticalSlug}
            onChange={(e) => setSelectedVerticalSlug(e.target.value)}
            disabled={disabled || loading}
            className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-slate-900 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
          >
            {loading ? (
              <option value="">Loading services...</option>
            ) : serviceDomains.length === 0 ? (
              <option value="">No services available</option>
            ) : (
              serviceDomains.map((domain) => (
                <option key={domain.id || domain.slug} value={domain.slug}>
                  {domain.name}
                </option>
              ))
            )}
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
            placeholder={getRequirementPlaceholder(activeDomain)}
            disabled={disabled}
            className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-slate-900 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition resize-none"
          />
        </div>

        <button
          type="submit"
          disabled={disabled || loading || !selectedVerticalSlug}
          className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold rounded-xl shadow-lg shadow-emerald-900/20 transition duration-200 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <span>Start Chat Session</span>
          <span className="h-2 w-2 rounded-full bg-white animate-ping"></span>
        </button>
      </form>
    </div>
  );
}