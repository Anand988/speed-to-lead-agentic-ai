// apps/web_intake/app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Intake AI - Customer Conversational Assistant',
  description: 'AI-powered customer intake and lead qualification platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-[#111827] text-slate-100 antialiased`}>
        {children}
      </body>
    </html>
  );
}