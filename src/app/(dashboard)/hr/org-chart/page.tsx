'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Loader2, ChevronDown, ChevronRight, Search, Users, Network, UserX } from 'lucide-react';
import { PageHeader, KpiRow, StatTile, toast } from '@/components/ui';
import { EmployeeName } from '@/components/hr/employee-name';

// Org chart (P1.5): reporting tree built from hr_employees.supervisor_id (→ profiles.id).
// Roots = employees with no supervisor inside the visible set. Search filters and auto-expands.
interface Node {
  nickname?: string | null;
  id: string;
  supervisor_id: string | null;
  name: string;
  username: string | null;
  avatar_url: string | null;
  position: string | null;
  department: string | null;
  status: string;
}

function Avatar({ node }: { node: Node }) {
  if (node.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={node.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-gray-800" />;
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
      {node.name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function HrOrgChartPage() {
  const isTh = useLocale() === 'th';
  const L = isTh
    ? { title: 'ผังองค์กร', subtitle: 'สายการบังคับบัญชาตามหัวหน้างานที่ตั้งไว้ในโปรไฟล์พนักงาน', total: 'พนักงานทั้งหมด', roots: 'หัวสายงาน', noSup: 'ยังไม่ระบุหัวหน้า', search: 'ค้นหาชื่อ / ตำแหน่ง', probation: 'ทดลองงาน', people: 'คน', empty: 'ไม่มีข้อมูล — ตั้ง "หัวหน้างาน" ในโปรไฟล์พนักงานเพื่อสร้างผัง', loadFailed: 'โหลดไม่สำเร็จ' }
    : { title: 'Org chart', subtitle: 'Reporting lines from the supervisor set on each employee profile', total: 'Employees', roots: 'Top of chain', noSup: 'No supervisor set', search: 'Search name / position', probation: 'Probation', people: '', empty: 'Nothing to draw — set "Supervisor" on employee profiles to build the chart', loadFailed: 'Load failed' };

  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/org-chart');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error);
      setNodes((json.data ?? []) as Node[]);
    } catch {
      toast({ type: 'error', title: L.loadFailed });
    } finally {
      setLoading(false);
    }
  }, [L.loadFailed]);

  useEffect(() => { load(); }, [load]);

  const { childrenOf, roots, matchIds } = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    const children = new Map<string, Node[]>();
    const rootList: Node[] = [];
    for (const n of nodes) {
      if (n.supervisor_id && ids.has(n.supervisor_id) && n.supervisor_id !== n.id) {
        const arr = children.get(n.supervisor_id) ?? [];
        children.set(n.supervisor_id, [...arr, n]);
      } else {
        rootList.push(n);
      }
    }
    // search: matched nodes + all their ancestors stay visible
    const needle = q.trim().toLowerCase();
    let visible: Set<string> | null = null;
    if (needle) {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      visible = new Set<string>();
      for (const n of nodes) {
        const hit =
          n.name.toLowerCase().includes(needle) ||
          (n.nickname ?? '').toLowerCase().includes(needle) ||
          (n.username ?? '').toLowerCase().includes(needle) ||
          (n.position ?? '').toLowerCase().includes(needle) ||
          (n.department ?? '').toLowerCase().includes(needle);
        if (!hit) continue;
        let cur: Node | undefined = n;
        // walk up so the match's chain renders (guard cycles with the visited set itself)
        while (cur && !visible.has(cur.id)) {
          visible.add(cur.id);
          cur = cur.supervisor_id ? byId.get(cur.supervisor_id) : undefined;
        }
      }
    }
    return { childrenOf: children, roots: rootList, matchIds: visible };
  }, [nodes, q]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const countSubtree = useCallback(
    (id: string): number => (childrenOf.get(id) ?? []).reduce((acc, c) => acc + 1 + countSubtree(c.id), 0),
    [childrenOf]
  );

  const renderNode = (n: Node, depth: number): React.ReactNode => {
    if (matchIds && !matchIds.has(n.id)) return null;
    const kids = (childrenOf.get(n.id) ?? []).filter((k) => !matchIds || matchIds.has(k.id));
    const isCollapsed = collapsed.has(n.id) && !matchIds; // search always expands
    const subCount = countSubtree(n.id);
    return (
      <div key={n.id} className={depth > 0 ? 'ml-4 border-l-2 border-gray-200 pl-3 dark:border-gray-700 sm:ml-6 sm:pl-4' : ''}>
        <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {kids.length > 0 || subCount > 0 ? (
            <button type="button" onClick={() => toggle(n.id)} className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700" aria-expanded={!isCollapsed}>
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <Avatar node={n} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
              <EmployeeName name={n.name} nickname={n.nickname} />
              {n.status === 'probation' && (
                <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">{L.probation}</span>
              )}
            </p>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              {[n.position, n.department].filter(Boolean).join(' · ') || n.username || '—'}
            </p>
          </div>
          {subCount > 0 && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-300">
              <Users className="h-3 w-3" /> {subCount}
            </span>
          )}
        </div>
        {!isCollapsed && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  const noSupCount = roots.filter((r) => !childrenOf.has(r.id)).length;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <PageHeader title={L.title} subtitle={L.subtitle} />

      <KpiRow cols={3}>
        <StatTile label={L.total} value={nodes.length} icon={Users} />
        <StatTile label={L.roots} value={roots.length} icon={Network} />
        <StatTile label={L.noSup} value={noSupCount} icon={UserX} tone={noSupCount > 0 ? 'warn' : 'default'} />
      </KpiRow>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L.search} className="control control-icon w-full" aria-label={L.search} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : nodes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700">{L.empty}</p>
      ) : (
        <div>{roots.map((r) => renderNode(r, 0))}</div>
      )}
    </div>
  );
}
