export function derivePrefix(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  return (letters + 'XXXX').slice(0, 4);
}

export function formatProjectCode(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(6, '0')}`;
}
