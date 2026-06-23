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

function getDB(): Promise<IDBPDatabase<KVSchema>> | null {
  if (!idbAvailable) return null;
  if (!dbPromise) {
    try {
      dbPromise = openDB<KVSchema>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE);
          }
        },
      }).catch((err) => {
        idbAvailable = false;
        dbPromise = null;
        throw err;
      });
    } catch {
      // openDB lançou sincronamente (jsdom / IndexedDB ausente).
      idbAvailable = false;
      return null;
    }
  }
  return dbPromise;
}

/** Lê um valor; tenta IndexedDB primeiro, depois localStorage. */
export async function loadKey<T = unknown>(key: string): Promise<T | null> {
  // 1) IndexedDB
  if (idbAvailable) {
    try {
      const db = await getDB();
      if (db) {
        const val = await db.get(STORE, key);
        if (val !== undefined) return val as T;
      }
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

/**
 * Salva um valor.
 *
 * Ordem: localStorage SÍNCRONO primeiro (preserva semântica setItem→getItem
 * imediato que muitos stores assumem), IndexedDB em background como camada
 * durável que tolera quota maior. Se localStorage estourar quota, IDB ainda
 * recebe o dado — a Promise só falha quando ambas as camadas falham.
 */
export async function saveKey(key: string, value: unknown): Promise<void> {
  let lsOk = false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    lsOk = true;
  } catch {
    // quota / modo privado — segue para IDB
  }
  if (idbAvailable) {
    try {
      const db = await getDB();
      if (db) {
        await db.put(STORE, value, key);
        return;
      }
    } catch {
      idbAvailable = false;
    }
  }
  if (!lsOk) {
    // Ambas as camadas falharam — sinaliza para o caller decidir.
    throw new Error(`saveKey: falha ao persistir "${key}" (localStorage e IDB)`);
  }
}

/**
 * Variante síncrona "fire-and-forget" para call sites que hoje usam
 * `localStorage.setItem` direto e não podem virar async sem cascata.
 * Grava localStorage sync e dispara IDB em background.
 */
export function saveKeySync(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota — IDB ainda tentará
  }
  const dbp = getDB();
  if (dbp) {
    void dbp
      .then((db) => db.put(STORE, value, key))
      .catch(() => {
        idbAvailable = false;
      });
  }
}

/** Remove uma chave de ambas as camadas (sync na parte de localStorage). */
export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignora */
  }
  const dbp = getDB();
  if (dbp) {
    void dbp
      .then((db) => db.delete(STORE, key))
      .catch(() => {
        idbAvailable = false;
      });
  }
}

// ─── Broadcast multi-aba ──────────────────────────────────────────────
// Nome do canal de broadcast multi-aba.
const CHANNEL_NAME = "finnance:sync";
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
