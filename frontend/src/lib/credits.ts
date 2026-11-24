// Things mumh5 ships or builds on, shown in Settings > About.
// Keep in step with THIRD_PARTY_NOTICES.md, which holds the full license texts.
export interface Credit { name: string; what: string; license: string; url: string }

export const credits: Credit[] = [
  { name: 'Mumble', what: 'Protocol definitions, and the server and desktop client this app stays compatible with', license: 'BSD-3-Clause', url: 'https://github.com/mumble-voip/mumble' },
  { name: 'DeepFilterNet', what: 'Noise suppression (engine and model)', license: 'MIT or Apache-2.0', url: 'https://github.com/Rikorose/DeepFilterNet' },
  { name: 'Opus and libopus', what: 'Voice codec; built-in WebAssembly build through @evan/opus', license: 'BSD-3-Clause, MIT', url: 'https://opus-codec.org' },
  { name: 'Inter', what: 'Interface typeface', license: 'SIL OFL 1.1', url: 'https://rsms.me/inter/' },
  { name: 'Chatterbox Turbo', what: 'Voices of the standard notification sound pack, generated locally', license: 'see the pack', url: 'https://github.com/resemble-ai/chatterbox' },
  { name: 'PDF.js', what: 'PDF previews', license: 'Apache-2.0', url: 'https://github.com/mozilla/pdf.js' },
  { name: 'highlight.js', what: 'Code snippets', license: 'BSD-3-Clause', url: 'https://highlightjs.org' },
  { name: 'DOMPurify', what: 'Sanitizing incoming HTML', license: 'MPL-2.0 or Apache-2.0', url: 'https://github.com/cure53/DOMPurify' },
  { name: 'protobufjs', what: 'Protocol buffers codec', license: 'BSD-3-Clause', url: 'https://github.com/protobufjs/protobuf.js' },
  { name: 'fflate', what: 'ZIP import for sound packs', license: 'MIT', url: 'https://github.com/101arrowz/fflate' },
  { name: 'unicode-emoji-json', what: 'Emoji picker data', license: 'MIT', url: 'https://github.com/muan/unicode-emoji-json' },
  { name: 'Tauri', what: 'Desktop shell', license: 'MIT', url: 'https://tauri.app' },
  { name: 'Svelte and Bun', what: 'Interface framework and build', license: 'MIT', url: 'https://svelte.dev' }
];
