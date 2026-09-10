'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MapPin, LocateFixed } from 'lucide-react';
import { Button, Input, PageHeader, StatusBadge, DataCard, DataList, ViewToggle, useViewMode, toast } from '@/components/ui';

interface BranchLocation {
  store_id: string;
  store_name: string | null;
  store_code: string | null;
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
  allow_outside_geofence: boolean;
  outside_max_distance_m: number;
}

interface Draft {
  lat: string;
  lng: string;
  radius: string;
  allowOutsideGeofence: boolean;
  outsideMaxDistance: string;
}

const DEFAULT_RADIUS = 150;

function toDraft(row: BranchLocation): Draft {
  return {
    lat: row.lat != null ? String(row.lat) : '',
    lng: row.lng != null ? String(row.lng) : '',
    radius: row.radius_m != null ? String(row.radius_m) : String(DEFAULT_RADIUS),
    allowOutsideGeofence: row.allow_outside_geofence ?? false,
    outsideMaxDistance: row.outside_max_distance_m != null
      ? String(row.outside_max_distance_m)
      : String(DEFAULT_RADIUS),
  };
}

export default function LocationsPage() {
  const t = useTranslations('hr.locations');

  const [rows, setRows] = useState<BranchLocation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [geoId, setGeoId] = useState<string | null>(null);
  const [view, setView] = useViewMode('hr-locations');

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
      [storeId]: {
        ...(prev[storeId] ?? {
          lat: '', lng: '', radius: String(DEFAULT_RADIUS),
          allowOutsideGeofence: false, outsideMaxDistance: String(DEFAULT_RADIUS),
        }),
        ...patch,
      },
    }));
  };

  const fillWithMyLocation = (storeId: string) => {
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
          allow_outside_geofence: draft.allowOutsideGeofence,
          outside_max_distance_m: Number(draft.outsideMaxDistance),
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
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<ViewToggle value={view} onChange={setView} />}
      />

      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
          {t('empty')}
        </div>
      ) : (
        <DataList compact={view === 'compact'}>
          {rows.map((row) => {
            const draft = drafts[row.store_id] ?? {
              lat: '', lng: '', radius: String(DEFAULT_RADIUS),
              allowOutsideGeofence: false, outsideMaxDistance: String(DEFAULT_RADIUS),
            };
            const isSet = row.lat != null && row.lng != null;
            const rowSaving = savingId === row.store_id;
            const rowLocating = geoId === row.store_id;

            return (
              <DataCard
                key={row.store_id}
                accent={isSet ? 'good' : 'neutral'}
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0 text-indigo-500" />
                    <span className="truncate">
                      {row.store_name ?? row.store_code ?? row.store_id}
                    </span>
                    {row.store_code && (
                      <span className="shrink-0 text-xs font-normal text-gray-400">{row.store_code}</span>
                    )}
                  </span>
                }
                status={
                  <StatusBadge
                    tone={isSet ? 'good' : 'neutral'}
                    label={isSet ? t('set') : t('notSet')}
                  />
                }
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => fillWithMyLocation(row.store_id)}
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
                    >
                      {rowSaving ? t('saving') : t('save')}
                    </Button>
                  </>
                }
              >
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                <div className="mt-3 grid grid-cols-1 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] dark:border-gray-700">
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm transition-colors hover:border-indigo-300 dark:border-gray-600 dark:hover:border-indigo-500">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={draft.allowOutsideGeofence}
                      disabled={rowSaving || rowLocating}
                      onChange={(e) => updateDraft(row.store_id, { allowOutsideGeofence: e.target.checked })}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-gray-900 dark:text-white">{t('allowOutsideGeofence')}</span>
                      <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                        {draft.allowOutsideGeofence ? t('outsideEnabled') : t('outsideDisabled')}
                      </span>
                      <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{t('allowOutsideGeofenceHelp')}</span>
                    </span>
                  </label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    id={`outside-max-distance-${row.store_id}`}
                    label={t('outsideMaxDistance')}
                    hint={t('outsideMaxDistanceHint')}
                    value={draft.outsideMaxDistance}
                    disabled={!draft.allowOutsideGeofence}
                    onChange={(e) => updateDraft(row.store_id, { outsideMaxDistance: e.target.value })}
                    className="tabular-nums"
                  />
                </div>
              </DataCard>
            );
          })}
        </DataList>
      )}
    </div>
  );
}
