'use client';

import { Suspense } from 'react';
import { Wine } from 'lucide-react';
import { BottleLoader } from './bottle-loader';
import { CustomerProvider, useCustomerAuth } from './customer-provider';
import { CustomerLocaleProvider } from './customer-locale-provider';
import { LangSwitch } from './lang-switch';
import '../customer-theme.css';

// ---------------------------------------------------------------------------
// Header — glass-morphism with brand logo + store subtitle
// ---------------------------------------------------------------------------
function CustomerHeader() {
  const { store } = useCustomerAuth();
  const title = 'ระบบรับฝากเหล้า';
  const subtitle = store.name || 'Alcohol Deposit';

  return (
    <header className="customer-header-bg sticky top-0 z-40">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="customer-logo-box">
          <Wine className="h-4 w-4" />
        </div>
        <div className="flex flex-col leading-tight min-w-0 flex-1">
          <h1 className="customer-brand-title truncate">{title}</h1>
          <span className="customer-brand-subtitle truncate">{subtitle}</span>
        </div>
        <LangSwitch />
      </div>
    </header>
  );
}

function CustomerShellInner({ children }: { children: React.ReactNode }) {
  return (
    <CustomerLocaleProvider>
      <CustomerProvider>
        <div className="customer-theme relative flex min-h-screen flex-col">
          {/* Ambient background orbs */}
          <div className="customer-ambient-bg" aria-hidden="true">
            <div className="customer-ambient-orb orb-1" />
            <div className="customer-ambient-orb orb-2" />
            <div className="customer-ambient-orb orb-3" />
          </div>

          {/* Top header */}
          <CustomerHeader />

          {/* Main content — bottom nav removed; safe-area padding only */}
          <main className="customer-scroll relative z-[5] flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {children}
          </main>
        </div>
      </CustomerProvider>
    </CustomerLocaleProvider>
  );
}

export function CustomerShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="customer-theme flex min-h-screen items-center justify-center">
          <BottleLoader label="Loading" />
        </div>
      }
    >
      <CustomerShellInner>{children}</CustomerShellInner>
    </Suspense>
  );
}
