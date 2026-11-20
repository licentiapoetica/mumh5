// Pokes, like TeamSpeak's: a short note that pops up for one person. Mumble has no such
// message, so a poke is a private text message with a marker. Other clients show it as a
// normal private message ("Poked you: ..."); the marker is an HTML comment, invisible there.

export const POKE_MARK = '<!--mumh5:poke-->';
export const POKE_PREFIX = 'Poked you';
export const POKE_MAX = 200;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function encodePoke(text: string): string {
  const t = text.trim().slice(0, POKE_MAX);
  return POKE_MARK + POKE_PREFIX + (t ? ': ' + escape(t) : '');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// The note as plain text, or null when the message is not a poke. Tags from other senders
// are dropped rather than trusted.
export function decodePoke(html: string): string | null {
  if (!html.startsWith(POKE_MARK)) return null;
  const text = html.slice(POKE_MARK.length)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .trim();
  const note = text.startsWith(POKE_PREFIX) ? text.slice(POKE_PREFIX.length).replace(/^:\s*/, '') : text;
  return note.trim().slice(0, POKE_MAX);
}
