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
  settingsTab = $state<'voice' | 'files' | 'identities'>('voice');
  // Session whose connection information is shown
  userInfo = $state<number | null>(null);
  // Set when a panel was opened on a layout where it is an overlay
  panelOpen = $state(false);
}

export const ui = new Ui();
