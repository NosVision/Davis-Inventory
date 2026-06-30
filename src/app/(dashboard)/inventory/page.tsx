'use client';

import { useEffect, useState } from 'react';
import { Boxes, FlaskConical } from 'lucide-react';
import { Tabs } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { CatalogTab } from '@/components/inventory/catalog-tab';
import { StockTab } from '@/components/inventory/stock-tab';
import { RequisitionsTab } from '@/components/inventory/requisitions-tab';
import { PurchaseOrdersTab } from '@/components/inventory/purchase-orders-tab';
import { SuppliersTab } from '@/components/inventory/suppliers-tab';
import { RecipesTab } from '@/components/inventory/recipes-tab';

const MGMT_ROLES = ['owner', 'manager', 'accountant'];

export default function InventoryPage() {
  const { user } = useAuthStore();
  const isMgmt = MGMT_ROLES.includes(user?.role ?? '');

  const [tab, setTab] = useState('catalog');
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('stores')
      .select('id, store_name')
      .eq('active', true)
      .order('store_name')
      .then(({ data }) => {
        setStores(((data as { id: string; store_name: string }[]) ?? []).map((s) => ({ id: s.id, name: s.store_name })));
      });
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30">
          <Boxes className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">จัดการสต๊อก</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <FlaskConical className="h-3 w-3" /> โมดูลใหม่ (ทดสอบ)
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            แคตตาล็อกกลาง (HQ) + สต๊อกแยกตามสาขา · ยอดคงเหลือแบบเรียลไทม์จากบัญชีเดินสต๊อก
          </p>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'catalog', label: 'แคตตาล็อก (HQ)' },
          { id: 'stock', label: 'สต๊อกสาขา' },
          { id: 'requisitions', label: 'ใบเบิก' },
          { id: 'purchase-orders', label: 'ใบสั่งซื้อ' },
          { id: 'recipes', label: 'สูตร (BOM)' },
          { id: 'suppliers', label: 'ซัพพลายเออร์' },
        ]}
        activeTab={tab}
        onChange={setTab}
      />

      {tab === 'catalog' && <CatalogTab isMgmt={isMgmt} />}
      {tab === 'stock' && <StockTab isMgmt={isMgmt} stores={stores} />}
      {tab === 'requisitions' && <RequisitionsTab isMgmt={isMgmt} stores={stores} />}
      {tab === 'purchase-orders' && <PurchaseOrdersTab isMgmt={isMgmt} />}
      {tab === 'recipes' && <RecipesTab isMgmt={isMgmt} stores={stores} />}
      {tab === 'suppliers' && <SuppliersTab isMgmt={isMgmt} />}
    </div>
  );
}
