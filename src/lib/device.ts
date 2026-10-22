import { storageGet, storageSet } from './util';

const KEY = 'kisk-device-id';
let memoryId: string | null = null;

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Random per-device id, kept in localStorage (or memory if storage is unavailable). */
export function deviceId(): string {
  if (memoryId) return memoryId;
  const stored = storageGet(KEY);
  if (stored && /^[0-9a-f-]{36}$/i.test(stored)) return (memoryId = stored);
  memoryId = uuid();
  storageSet(KEY, memoryId);
  return memoryId;
}
