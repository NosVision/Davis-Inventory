import type { Metadata } from 'next';
import { CustomerShell } from './_components/customer-shell';

// The customer-facing bottle-deposit portal is branded separately from the staff app and installs
// as its own PWA (own name + icon on the home screen). This server layout overrides the root
// metadata's title + manifest for everything under /customer.
export const metadata: Metadata = {
  title: 'ระบบรับฝากเหล้า - Alcohol Deposit',
  applicationName: 'ระบบรับฝากเหล้า - Alcohol Deposit',
  manifest: '/customer-manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'รับฝากเหล้า',
  },
};

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return <CustomerShell>{children}</CustomerShell>;
}
