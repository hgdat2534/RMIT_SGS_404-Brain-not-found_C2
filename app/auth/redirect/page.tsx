'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTideCloak } from '@tidecloak/nextjs';

export default function AuthRedirectPage() {
  const router = useRouter();
  const { authenticated, isInitializing } = useTideCloak();

  useEffect(() => {
    if (!isInitializing) {
      router.replace('/');
    }
  }, [isInitializing, authenticated, router]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
      <div className="p-6 rounded-xl border border-indigo-500/30 bg-slate-900/80 text-center space-y-2">
        <div className="animate-spin h-8 w-8 border-2 border-indigo-400 border-t-transparent rounded-full mx-auto" />
        <p className="text-sm font-medium">Completing TideCloak DPoP & Enclave Handshake...</p>
      </div>
    </div>
  );
}
