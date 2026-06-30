'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, LayoutGrid } from 'lucide-react';
import { Select, Tabs } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { FloorPlanBuilder } from '@/components/pos/floor-plan-builder';
import { MenuManager } from '@/components/pos/menu-manager';
import { ModifierManager } from '@/components/pos/modifier-manager';

export default function PosManagePage() {
  const { user } = useAuthStore();
  const isManager = ['owner', 'manager'].includes(user?.role ?? '');
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeId, setStoreId] = useState('');
  const [tab, setTab] = useState('floor');

  useEffect(() => {
    const sb = createClient();
    sb.from('stores')
      .select('id, store_name')
      .eq('active', true)
      .order('store_name')
      .then(({ data }) => {
        const ss = ((data as { id: string; store_name: string }[]) ?? []).map((s) => ({ id: s.id, name: s.store_name }));
        setStores(ss);
        if (ss[0]) setStoreId(ss[0].id);
      });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href="/pos" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30">
            <LayoutGrid className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">ตั้งค่า POS</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">ผังโต๊ะ (หลายชั้น/โซน) · เมนู + สูตร</p>
          </div>
        </div>
        {stores.length > 1 && (
          <div className="w-52">
            <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
          </div>
        )}
      </div>

      <Tabs
        tabs={[
          { id: 'floor', label: 'ผังโต๊ะ' },
          { id: 'menu', label: 'เมนู + สูตร' },
          { id: 'modifiers', label: 'ตัวเลือก' },
        ]}
        activeTab={tab}
        onChange={setTab}
      />

      {storeId && tab === 'floor' && <FloorPlanBuilder storeId={storeId} isManager={isManager} />}
      {storeId && tab === 'menu' && <MenuManager storeId={storeId} isManager={isManager} />}
      {storeId && tab === 'modifiers' && <ModifierManager storeId={storeId} isManager={isManager} />}
    </div>
  );
}
