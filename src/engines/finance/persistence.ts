// Camada de persistência unificada: IndexedDB (principal) com fallback
// silencioso para localStorage.
//
// API pública intencionalmente síncrona-amigável: hooks consomem
// `loadKey(key)` / `saveKey(key, value)` retornando Promises, com
// fallback transparente quando IndexedDB falha (modo privado, quota,
// browsers antigos).
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "FinanceProDB";
const DB_VERSION = 1;
const STORE = "kv"; // key-value genérico para os hooks existentes

interface KVSchema {
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<KVSchema>> | null = null;
let idbAvailable = true;

function getDB(): Promise<IDBPDatabase<KVSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<KVSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    }).catch((err) => {
      idbAvailable = false;
      // Reseta para permitir nova tentativa em sessão futura
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** Lê um valor; tenta IndexedDB primeiro, depois localStorage. */
export async function loadKey<T = unknown>(key: string): Promise<T | null> {
  // 1) IndexedDB
  if (idbAvailable) {
    try {
      const db = await getDB();
      const val = await db.get(STORE, key);
      if (val !== undefined) return val as T;
    } catch {
      idbAvailable = false;
    }
  }
  // 2) Fallback: localStorage (também atende migração da v anterior)
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as T;
    // Migração silenciosa para IndexedDB se disponível
    if (idbAvailable) {
      saveKey(key, parsed).catch(() => {
        /* ignora */
      });
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Salva um valor em IndexedDB; espelha em localStorage como backup (best-effort). */
export async function saveKey(key: string, value: unknown): Promise<void> {
  let idbOk = false;
  if (idbAvailable) {
    try {
      const db = await getDB();
      await db.put(STORE, value, key);
      idbOk = true;
    } catch {
      idbAvailable = false;
    }
  }
  // Espelho em localStorage: garante leitura mesmo se IDB falhar depois.
  // Em quota exceeded, ignora silenciosamente — IDB já tem o dado.
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    if (!idbOk) {
      // Sem IDB e sem localStorage — nada a fazer; notifica via broadcast de erro?
      // Mantém silencioso por ora (consistente com comportamento anterior).
    }
  }
}

/** Remove uma chave de ambas as camadas. */
export async function removeKey(key: string): Promise<void> {
  if (idbAvailable) {
    try {
      const db = await getDB();
      await db.delete(STORE, key);
    } catch {
      idbAvailable = false;
    }
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignora */
  }
}

// ─── Broadcast multi-aba ──────────────────────────────────────────────
// Nome legado mantido para compat com abas já abertas em deploys antigos.
const CHANNEL_NAME = "gzfp:sync";
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

/** Notifica outras abas que uma chave foi alterada. */
export function broadcastChange(key: string): void {
  const ch = getChannel();
  if (!ch) return;
  try {
    ch.postMessage({ type: "key-changed", key, ts: Date.now() });
  } catch {
    /* ignora */
  }
}

/** Escuta alterações vindas de outras abas. Retorna unsubscribe. */
export function onRemoteChange(handler: (key: string) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = (ev: MessageEvent) => {
    const data = ev.data as { type?: string; key?: string } | null;
    if (data?.type === "key-changed" && typeof data.key === "string") {
      handler(data.key);
    }
  };
  ch.addEventListener("message", listener);
  return () => ch.removeEventListener("message", listener);
}
