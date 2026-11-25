// Escaping for HTML and XHTML sent to stock Mumble clients. Text nodes may keep quotes;
// double-quoted attribute values must escape them too.
export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeHtml(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}
