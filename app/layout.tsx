import './globals.css';
import type { Metadata } from 'next';
import TideClientWrapper from '@/components/TideClientWrapper';

export const metadata: Metadata = {
  title: 'BlindVault | True-Blind Grading Powered by TideCloak Emergent Authority',
  description:
    'RMIT Hackathon Challenge 2 (UNLOCKED) Prototype: Mathematically guaranteed blind evaluation with TideCloak.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <TideClientWrapper>{children}</TideClientWrapper>
      </body>
    </html>
  );
}
