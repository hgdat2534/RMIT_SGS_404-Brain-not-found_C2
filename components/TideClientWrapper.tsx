'use client';

import React from 'react';
import { TideCloakProvider } from '@tidecloak/nextjs';
import adapter from '@/tidecloak.json';

export default function TideClientWrapper({ children }: { children: React.ReactNode }) {
  return (
    <TideCloakProvider config={adapter as any}>
      {children}
    </TideCloakProvider>
  );
}
