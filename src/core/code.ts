// Code snippets in chat: highlighting and the form they take on the wire.
//
// A snippet is sent as <pre title="python">escaped code</pre>. Stock Mumble clients render <pre>
// as preformatted text and ignore the language. The desktop client's own Markdown sends
// ```code``` blocks as <pre> with <br/> line breaks and no language, so the language of a block
// without a known title is detected here.
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cmake from 'highlight.js/lib/languages/cmake';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import elixir from 'highlight.js/lib/languages/elixir';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import haskell from 'highlight.js/lib/languages/haskell';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import nginx from 'highlight.js/lib/languages/nginx';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import protobuf from 'highlight.js/lib/languages/protobuf';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { escapeText } from './html.ts';

// The id goes on the wire; aliases (js, py, sh, html, toml, ...) are accepted for it
export const LANGUAGES = [
  { id: 'bash', name: 'Bash', def: bash },
  { id: 'c', name: 'C', def: c },
  { id: 'cpp', name: 'C++', def: cpp },
  { id: 'csharp', name: 'C#', def: csharp },
  { id: 'cmake', name: 'CMake', def: cmake },
  { id: 'css', name: 'CSS', def: css },
  { id: 'dart', name: 'Dart', def: dart },
  { id: 'diff', name: 'Diff', def: diff },
  { id: 'dockerfile', name: 'Dockerfile', def: dockerfile },
  { id: 'elixir', name: 'Elixir', def: elixir },
  { id: 'go', name: 'Go', def: go },
  { id: 'graphql', name: 'GraphQL', def: graphql },
  { id: 'haskell', name: 'Haskell', def: haskell },
  { id: 'xml', name: 'HTML / XML', def: xml },
  { id: 'ini', name: 'INI / TOML', def: ini },
  { id: 'java', name: 'Java', def: java },
  { id: 'javascript', name: 'JavaScript', def: javascript },
  { id: 'json', name: 'JSON', def: json },
  { id: 'kotlin', name: 'Kotlin', def: kotlin },
  { id: 'lua', name: 'Lua', def: lua },
  { id: 'makefile', name: 'Makefile', def: makefile },
  { id: 'markdown', name: 'Markdown', def: markdown },
  { id: 'nginx', name: 'Nginx', def: nginx },
  { id: 'perl', name: 'Perl', def: perl },
  { id: 'php', name: 'PHP', def: php },
  { id: 'plaintext', name: 'Plain text', def: plaintext },
  { id: 'powershell', name: 'PowerShell', def: powershell },
  { id: 'protobuf', name: 'Protocol Buffers', def: protobuf },
  { id: 'python', name: 'Python', def: python },
  { id: 'ruby', name: 'Ruby', def: ruby },
  { id: 'rust', name: 'Rust', def: rust },
  { id: 'scss', name: 'SCSS', def: scss },
  { id: 'sql', name: 'SQL', def: sql },
  { id: 'swift', name: 'Swift', def: swift },
  { id: 'typescript', name: 'TypeScript', def: typescript },
  { id: 'yaml', name: 'YAML', def: yaml }
] as const;

for (const l of LANGUAGES) hljs.registerLanguage(l.id, l.def);

// Below this score a guess is no better than chance (measured: prose and ASCII tables score
// 0 to 2, short real snippets 4 and up)
const MIN_RELEVANCE = 4;

// The canonical id for a language id or alias, or null when it is not one we highlight
export function languageId(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const def = hljs.getLanguage(tag.trim().toLowerCase());
  return def ? LANGUAGES.find(l => hljs.getLanguage(l.id) === def)?.id ?? null : null;
}

export function languageName(id: string): string {
  return LANGUAGES.find(l => l.id === id)?.name ?? id;
}

// The best guess with its highlighting, or null when nothing fits well enough. ASCII tables and
// art score as code in some grammars (all those operators), so mostly letters are wanted.
function guess(code: string): { html: string; lang: string } | null {
  const visible = code.replace(/\s+/g, '').length;
  if (!visible || (code.match(/\p{L}/gu)?.length ?? 0) < visible * 0.3) return null;
  const r = hljs.highlightAuto(code);
  return r.language && r.relevance >= MIN_RELEVANCE ? { html: r.value, lang: r.language } : null;
}

// The most likely language, or null when nothing fits well enough
export function detectLanguage(code: string): string | null {
  return guess(code)?.lang ?? null;
}

// Highlighted HTML (escaped text in <span class="hljs-...">) and the language used. Without a
// known language it is detected; null means plain escaped text.
export function highlightCode(code: string, lang?: string | null): { html: string; lang: string | null } {
  const id = languageId(lang);
  if (id) return { html: hljs.highlight(code, { language: id, ignoreIllegals: true }).value, lang: id };
  return guess(code) ?? { html: escapeText(code), lang: null };
}

// Surrounding blank lines and trailing spaces go; indentation of the first line stays
export function tidyCode(code: string): string {
  return code.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
}

// A snippet as sent. The language is detected when not given (unless `detect` is false), so every
// client shows the same one.
export function codeBlockHtml(code: string, lang?: string | null, detect = true): string {
  const text = tidyCode(code);
  const id = languageId(lang) ?? (detect ? detectLanguage(text) : null);
  return `<pre${id ? ` title="${id}"` : ''}>${escapeText(text)}</pre>`;
}

export type TextPart = { text: string } | { code: string; lang: string };

// Splits composer text at ```fences```. "```js" followed by a line break names the language;
// "```one line```" is code without one. An unclosed fence stays text. The line break next to a
// fence is part of it (a block starts on its own line anyway).
export function splitFences(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const re = /```(?:([\w+#.-]*)[ \t]*\n)?([\s\S]*?)```[ \t]*(?:\r?\n)?/g;
  let at = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(text));) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index).replace(/\r?\n$/, '') });
    parts.push({ code: m[2], lang: m[1] ?? '' });
    at = re.lastIndex;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts.filter(p => !('text' in p) || p.text);
}

// True when the text ends inside an open fence: Enter there adds a line instead of sending
export function inOpenFence(textBefore: string): boolean {
  return (textBefore.match(/```/g)?.length ?? 0) % 2 === 1;
}
