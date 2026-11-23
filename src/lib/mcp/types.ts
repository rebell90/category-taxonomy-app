export type ToolContent = { type: 'text'; text: string };
export type ToolResult = { content: ToolContent[]; isError?: boolean };

export function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function normalizeGid(raw: string): string {
  if (!raw) return raw;
  if (raw.startsWith('gid://shopify/Product/')) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Product/${raw}`;
  return raw;
}

/** Normalize a string for near-duplicate detection */
export function normalizeForDup(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}
