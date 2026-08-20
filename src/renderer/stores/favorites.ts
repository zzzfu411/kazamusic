import { useEffect, useState } from "react";
import type { Track } from "../../shared/types";

type FavoritesListener = (ids: string[]) => void;

const listeners = new Set<FavoritesListener>();
const ids = new Set<string>();
const addedAt = new Map<string, string>();
const pendingDesired = new Map<string, boolean>();

let loaded = false;
let loading: Promise<void> | null = null;

function snapshotIds(): string[] {
  return [...ids];
}

function emit(): void {
  const next = snapshotIds();
  for (const listener of listeners) listener(next);
}

function collectIds(raw: unknown): Array<{ id: string; createdAt?: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; createdAt?: string }> = [];
  for (const item of raw) {
    if (typeof item === "string" && item) {
      out.push({ id: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const rec = item as { track_id?: unknown; id?: unknown; created_at?: unknown };
    const id = typeof rec.track_id === "string" ? rec.track_id : typeof rec.id === "string" ? rec.id : "";
    if (!id) continue;
    out.push({
      id,
      createdAt: typeof rec.created_at === "string" ? rec.created_at : undefined,
    });
  }
  return out;
}

function persist(): void {
  const api = window.electronAPI;
  if (!api?.dbSaveFavorites) return;
  const idsToSave = snapshotIds();
  void Promise.resolve(api.dbSaveFavorites(idsToSave)).catch(() => undefined);
}

function rememberTrack(track: Track): void {
  const api = window.electronAPI;
  if (!api?.dbUpsertTrackCache) return;
  void api.dbUpsertTrackCache(track);
}

function applyDesired(id: string, desired: boolean): void {
  if (desired) {
    if (!ids.has(id)) addedAt.set(id, new Date().toISOString());
    ids.add(id);
    return;
  }
  ids.delete(id);
  addedAt.delete(id);
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (loading) return loading;
  const api = window.electronAPI;
  loading = (async () => {
    try {
      const raw = api?.dbLoadFavorites ? await api.dbLoadFavorites() : [];
      const rows = collectIds(raw);
      const next = new Set<string>();
      const nextAt = new Map<string, string>();
      for (const row of rows) {
        next.add(row.id);
        if (row.createdAt) nextAt.set(row.id, row.createdAt);
      }
      for (const [id, desired] of pendingDesired) {
        if (desired) {
          next.add(id);
          if (!nextAt.has(id)) nextAt.set(id, new Date().toISOString());
        } else {
          next.delete(id);
          nextAt.delete(id);
        }
      }
      const hadPending = pendingDesired.size > 0;
      pendingDesired.clear();
      ids.clear();
      addedAt.clear();
      for (const id of next) ids.add(id);
      for (const [id, at] of nextAt) addedAt.set(id, at);
      if (hadPending) persist();
      loaded = true;
    } catch {
      /* keep in-memory / pending so a later retry can persist */
    } finally {
      loading = null;
      emit();
    }
  })();
  return loading;
}

export function isFavorite(id: string): boolean {
  void ensureLoaded();
  return ids.has(id);
}

export function toggleFavorite(track: Track): boolean {
  const id = track?.id;
  if (!id) return false;
  const desired = !ids.has(id);
  applyDesired(id, desired);
  emit();
  if (desired) rememberTrack(track);
  if (!loaded) {
    pendingDesired.set(id, desired);
    void ensureLoaded();
    return desired;
  }
  persist();
  return desired;
}

export function getFavoriteIds(): string[] {
  void ensureLoaded();
  return snapshotIds();
}

export function useFavorites(): {
  ids: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (track: Track) => boolean;
} {
  const [list, setList] = useState(snapshotIds);
  useEffect(() => {
    const onChange: FavoritesListener = (next) => setList(next);
    listeners.add(onChange);
    void ensureLoaded();
    setList(snapshotIds());
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  return { ids: list, isFavorite, toggleFavorite };
}

if (typeof window !== "undefined") void ensureLoaded();
