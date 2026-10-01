import type { CertDetails } from '../core/transport.ts';

export interface PromptRequest {
  title: string;
  label: string;
  confirm: string;
  danger?: boolean;
  input?: 'text' | 'password' | 'none';
  initial?: string;
  text?: string;
  onsubmit: (value: string) => void;
}

export interface CertRequest {
  title: string;
  chain: CertDetails[];
  status?: { ok: boolean; text: string };
}

// App-wide dialogs that can be opened from anywhere (menus, panels)
class Ui {
  prompt = $state<PromptRequest | null>(null);
  cert = $state<CertRequest | null>(null);
  settingsOpen = $state(false);
  wizard = $state<'setup' | 'add' | null>(null);
  // Quick audio popover from right-clicking mute (input) or deafen (output)
  quickAudio = $state<{ kind: 'input' | 'output'; x: number; y: number } | null>(null);
  settingsTab = $state<'voice' | 'sounds' | 'appearance' | 'files' | 'identities'>('voice');
  publicServers = $state(false);
  serverInfo = $state(false);
  // Add-server dialog, optionally prefilled (from the public list)
  addServer = $state<{ host?: string; port?: number; label?: string } | null>(null);
  // Channel dialog: create a subchannel of `parent`, or edit channel `id`
  channelDialog = $state<{ mode: 'create'; parent: number } | { mode: 'edit'; id: number; tab?: 'general' | 'permissions' | 'groups' } | null>(null);
  // Session whose connection information is shown
  userInfo = $state<number | null>(null);
  // Set when a panel was opened on a layout where it is an overlay
  panelOpen = $state(false);
}

export const ui = new Ui();
