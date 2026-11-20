import type { Card, Terminal, Worker } from "./api";
import { cardMessage } from "./board";

export type Recipient = "worker" | "chat";

export interface ComposerKey {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}

export interface Outgoing {
  terminal: string;
  text: string;
  to: string;
}

export interface Recipients {
  card: Pick<Card, "id" | "title">;
  worker: Worker;
  workerReachable: boolean;
  chatTerminal: Terminal | null;
}

export function sendsOnKey(e: ComposerKey): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing;
}

export function canReach(recipient: Recipient, to: Recipients): boolean {
  return recipient === "worker" ? to.workerReachable : to.chatTerminal !== null;
}

export function outgoing(recipient: Recipient, draft: string, to: Recipients): Outgoing | null {
  const text = draft.trim();
  if (!text) return null;
  if (recipient === "worker") return to.workerReachable ? { terminal: to.worker.terminal, text, to: to.worker.terminal } : null;
  const chat = to.chatTerminal;
  return chat ? { terminal: chat.address, text: cardMessage(to.card, text), to: chat.name || chat.address } : null;
}
