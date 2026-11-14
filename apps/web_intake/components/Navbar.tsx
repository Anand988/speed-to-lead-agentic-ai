// apps/web_intake/components/Navbar.tsx
'use client';

import React from 'react';

export default function Navbar() {
  return (
    <header className="w-full border-b border-slate-800/80 bg-[#111827] px-8 py-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
          ✦
        </div>
        <span className="font-semibold text-lg tracking-wide text-white">Intake AI</span>
      </div>
      <nav className="flex items-center gap-6 text-sm text-slate-400">
        <span className="hover:text-white cursor-pointer transition">Dashboard</span>
        <span className="hover:text-white cursor-pointer transition">History</span>
        <span className="hover:text-white cursor-pointer transition">Support</span>
      </nav>
    </header>
  );
}