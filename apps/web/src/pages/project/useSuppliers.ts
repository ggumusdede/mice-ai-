import { useEffect, useState } from 'react';
import type { Supplier } from '@mice/shared';
import { api } from '../../api/client';

let cache: Promise<Supplier[]> | null = null;

/** Supplier directory (cached per session) for showing names next to offers / evaluations. */
export function useSuppliers(): { suppliers: Supplier[]; byId: Map<string, Supplier>; refresh: () => void } {
  const [list, setList] = useState<Supplier[]>([]);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!cache || n > 0) cache = api.suppliers.list().catch(() => []);
    let alive = true;
    void cache.then((s) => alive && setList(s));
    return () => {
      alive = false;
    };
  }, [n]);
  return { suppliers: list, byId: new Map(list.map((s) => [s.id, s])), refresh: () => setN((x) => x + 1) };
}

export function supplierName(byId: Map<string, Supplier>, id: string | null | undefined): string {
  if (!id) return '—';
  return byId.get(id)?.name ?? `#${id.slice(0, 6)}`;
}
