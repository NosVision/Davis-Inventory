'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MapPin, LocateFixed } from 'lucide-react';
import { Button, Input, toast } from '@/components/ui';

interface BranchLocation {
  store_id: string;
  store_name: string | null;
  store_code: string | null;
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
}

interface Draft {
  lat: string;
  lng: string;
  radius: string;
}

const DEFAULT_RADIUS = 150;

function toDraft(row: BranchLocation): Draft {
  return {
    lat: row.lat != null ? String(row.lat) : '',
    lng: row.lng != null ? String(row.lng) : '',
    radius: row.radius_m != null ? String(row.radius_m) : String(DEFAULT_RADIUS),
  };
}

export default function LocationsPage() {
  const t = useTranslations('hr.locations');

  const [rows, setRows] = useState<BranchLocation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [geoId, setGeoId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/locations');
      if (res.ok) {
        const json = await res.json();
        const data = (json.data ?? []) as BranchLocation[];
        setRows(data);
        setDrafts(Object.fromEntries(data.map((r) => [r.store_id, toDraft(r)])));
      } else {
        const json = await res.json().catch(() => ({}));
        toast({ type: 'error', title: t('saveFailed'), message: json.error });
      }
    } catch (err) {
      toast({
        type: 'error',
        title: t('saveFailed'),
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const updateDraft = (storeId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [storeId]: { ...(prev[storeId] ?? { lat: '', lng: '', radius: String(DEFAULT_RADIUS) }), ...patch },
    }));
  };

  const useMyLocation = (storeId: string) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast({ type: 'error', title: t('geoFailed') });
      return;
    }
    setGeoId(storeId);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updateDraft(storeId, {
          lat: String(pos.coords.latitude),
          lng: String(pos.coords.longitude),
        });
        setGeoId(null);
      },
      () => {
        toast({ type: 'error', title: t('geoFailed') });
        setGeoId(null);
      }
    );
  };

  const save = async (storeId: string) => {
    const draft = drafts[storeId];
    if (!draft) return;
    setSavingId(storeId);
    try {
      const res = await fetch('/api/hr/locations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          lat: Number(draft.lat),
          lng: Number(draft.lng),
          radius_m: Number(draft.radius),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast({ type: 'error', title: t('saveFailed'), message: json.error });
        return;
      }
      toast({ type: 'success', title: t('saved') });
      await fetchRows();
    } catch (err) {
      toast({
        type: 'error',
        title: t('saveFailed'),
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
          {t('empty')}
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const draft = drafts[row.store_id] ?? { lat: '', lng: '', radius: String(DEFAULT_RADIUS) };
            const isSet = row.lat != null && row.lng != null;
            const rowSaving = savingId === row.store_id;
            const rowLocating = geoId === row.store_id;

            return (
              <li
                key={row.store_id}
                className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0 text-indigo-500" />
                    <span className="truncate font-medium text-gray-900 dark:text-white">
                      {row.store_name ?? row.store_code ?? row.store_id}
                    </span>
                    {row.store_code && (
                      <span className="shrink-0 text-xs text-gray-400">{row.store_code}</span>
                    )}
                  </div>
                  <span
                    className={
                      isSet
                        ? 'shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    }
                  >
                    {isSet ? t('set') : t('notSet')}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Input
                    type="number"
                    label={t('lat')}
                    value={draft.lat}
                    onChange={(e) => updateDraft(row.store_id, { lat: e.target.value })}
                    className="tabular-nums"
                  />
                  <Input
                    type="number"
                    label={t('lng')}
                    value={draft.lng}
                    onChange={(e) => updateDraft(row.store_id, { lng: e.target.value })}
                    className="tabular-nums"
                  />
                  <Input
                    type="number"
                    label={t('radius')}
                    value={draft.radius}
                    onChange={(e) => updateDraft(row.store_id, { radius: e.target.value })}
                    className="tabular-nums"
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => useMyLocation(row.store_id)}
                    isLoading={rowLocating}
                    disabled={rowSaving}
                    icon={<LocateFixed className="h-4 w-4" />}
                  >
                    {rowLocating ? t('gettingLocation') : t('useMyLocation')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => save(row.store_id)}
                    isLoading={rowSaving}
                    disabled={rowLocating}
                    className="ml-auto"
                  >
                    {rowSaving ? t('saving') : t('save')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
