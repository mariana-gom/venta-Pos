// Web (administración y pruebas): almacenamiento del navegador. En el celular se usa storage.native.ts (SQLite).
export async function read<T>(key: string): Promise<T | null> {
  try { const v = localStorage.getItem('pos-' + key); return v ? JSON.parse(v) : null; } catch { return null; }
}
export async function write(key: string, value: unknown) {
  if (value === null) localStorage.removeItem('pos-' + key); else localStorage.setItem('pos-' + key, JSON.stringify(value));
}
