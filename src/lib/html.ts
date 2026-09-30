import DOMPurify, { type Config } from 'dompurify';

export type EmbedKind = 'image' | 'video' | 'audio' | 'youtube' | 'link';
export interface Embed { kind: EmbedKind; url: string; name: string; videoId?: string; start?: number }

// YouTube links: watch, youtu.be, shorts, embed, live, music, mobile
export function youtubeVideo(href: string): { id: string; start: number } | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = '';
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v') ?? '';
    else id = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? '';
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  // t=90, t=1m30s, start=90
  const t = u.searchParams.get('t') ?? u.searchParams.get('start') ?? '';
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
  const start = m ? (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) : 0;
  return { id, start };
}

const EXT: Record<string, EmbedKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
  mp3: 'audio', ogg: 'audio', opus: 'audio', wav: 'audio', flac: 'audio', m4a: 'audio'
};

export function mediaKind(name: string): EmbedKind | null {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? EXT[m[1].toLowerCase()] ?? null : null;
}

const purifyConfig: Config & { RETURN_DOM_FRAGMENT: true } = {
  ALLOWED_TAGS: ['a', 'b', 'i', 'u', 's', 'strong', 'em', 'br', 'p', 'span', 'div', 'ul', 'ol', 'li',
    'blockquote', 'code', 'pre', 'img', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'hr', 'sub', 'sup', 'font'],
  // style is reduced to a safe subset below; color is the <font color> attribute older clients send
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style', 'color'],
  ALLOW_DATA_ATTR: false,
  RETURN_DOM_FRAGMENT: true
};

// Text styling that Mumble clients (Qt rich text) use; anything else is dropped
const STYLE_PROPS: Record<string, RegExp> = {
  'color': /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i,
  'background-color': /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i,
  'font-weight': /^(normal|bold|bolder|lighter|[1-9]00)$/i,
  'font-style': /^(normal|italic|oblique)$/i,
  'text-decoration': /^(none|underline|line-through|overline)( (underline|line-through|overline))*$/i,
  'font-size': /^(\d{1,2}(\.\d+)?(pt|px|em|%)|small|medium|large|x-large|xx-large|smaller|larger)$/i,
  'text-align': /^(left|right|center|justify)$/i
};

// rgb(1, 2, 3) -> #010203, which every Mumble client understands
function normalizeColor(v: string): string {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
  return m ? '#' + m.slice(1, 4).map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('') : v;
}

export function cleanStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    let value = decl.slice(i + 1).trim().replace(/\s*!important$/i, '');
    if (!STYLE_PROPS[prop]?.test(value)) continue;
    if (prop.endsWith('color')) value = normalizeColor(value);
    out.push(`${prop}:${value}`);
  }
  return out.join(';');
}

DOMPurify.addHook('afterSanitizeAttributes', node => {
  const el = node as Element;
  if (el.hasAttribute('style')) {
    const clean = cleanStyle(el.getAttribute('style') ?? '');
    if (clean) el.setAttribute('style', clean);
    else el.removeAttribute('style');
  }
  if (el.hasAttribute('color') && !STYLE_PROPS.color.test(el.getAttribute('color') ?? '')) el.removeAttribute('color');
  if (el.tagName === 'A') {
    const href = el.getAttribute('href') ?? '';
    if (!/^https?:\/\//i.test(href)) el.removeAttribute('href');
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }
  // Only inline data: images; remote images would leak our IP to arbitrary hosts
  if (el.tagName === 'IMG' && !/^data:image\/(png|jpe?g|gif|webp);/i.test(el.getAttribute('src') ?? '')) {
    el.replaceWith(document.createTextNode('[image]'));
  }
});

// Sanitize an incoming Mumble HTML message and pull out media links from trusted hosts.
export function renderIncoming(html: string, trustedHosts: string[]): { html: string; embeds: Embed[] } {
  const frag = DOMPurify.sanitize(html, purifyConfig);
  const embeds: Embed[] = [];
  for (const a of frag.querySelectorAll('a[href]')) {
    const yt = youtubeVideo(a.getAttribute('href')!);
    if (yt) {
      if (!embeds.some(e => e.videoId === yt.id) && embeds.filter(e => e.kind === 'youtube').length < 3) {
        embeds.push({ kind: 'youtube', url: a.getAttribute('href')!, name: a.textContent ?? '', videoId: yt.id, start: yt.start });
      }
      continue;
    }
    let url: URL;
    try { url = new URL(a.getAttribute('href')!); } catch { continue; }
    const trusted = trustedHosts.includes(url.host.toLowerCase());
    const name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const kind = trusted ? mediaKind(name) : null;
    if (kind) embeds.push({ kind, url: url.href, name });
    // Other web links get a preview card (not for the upload host's own files)
    else if (!trusted && /^https?:$/.test(url.protocol) && embeds.filter(e => e.kind === 'link').length < 2 && !embeds.some(e => e.url === url.href)) {
      embeds.push({ kind: 'link', url: url.href, name: a.textContent ?? '' });
    }
  }
  // The inline thumbnail is only there for vanilla clients; we show the real media instead
  if (embeds.some(e => e.kind === 'image' || e.kind === 'video' || e.kind === 'audio')) frag.querySelectorAll('img').forEach(img => img.remove());
  const div = document.createElement('div');
  div.append(frag);
  return { html: div.innerHTML.replace(/^(<br\s*\/?>)+|(<br\s*\/?>)+$/g, ''), embeds };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Plain composer text to the HTML Mumble clients expect: escaped, links clickable, newlines as <br/>.
// Output must stay well-formed XML: Murmur parses long messages as XML and denies them otherwise.
export function textToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/https?:\/\/[^\s<]+[^\s<.,:;"')\]]/g, url => `<a href="${url}">${url}</a>`)
    .replace(/\r?\n/g, '<br/>');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

// ─── Outgoing rich text (comments) ────────────────────────────────────────────

const VOID_TAGS = new Set(['br', 'hr', 'img']);
const OUT_ATTRS = new Set(['href', 'src', 'alt', 'title', 'style', 'color']);
const escText = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (t: string) => escText(t).replace(/"/g, '&quot;');

function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escText(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const attrs = [...el.attributes].filter(a => OUT_ATTRS.has(a.name)).map(a => ` ${a.name}="${escAttr(a.value)}"`).join('');
  if (VOID_TAGS.has(tag)) return `<${tag}${attrs}/>`;
  return `<${tag}${attrs}>${[...el.childNodes].map(serialize).join('')}</${tag}>`;
}

// Sanitized, well-formed XHTML that Murmur's XML check accepts and Mumble clients render
export function toMumbleHtml(html: string): string {
  const frag = DOMPurify.sanitize(html, purifyConfig);
  return [...frag.childNodes].map(serialize).join('')
    .replace(/(<p><br\/><\/p>)+$/, '')
    .replace(/^(<br\/>)+|(<br\/>)+$/g, '')
    .trim();
}

