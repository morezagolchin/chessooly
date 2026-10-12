import type { Square } from 'chess.js';
import Peer, { type DataConnection } from 'peerjs';

/** Game modes from the sidebar. The host's choice is used for an online game. */
export type Variant = 'classic' | 'disguised' | 'disguised-opponent' | 'disguised-self' | 'invisible' | 'points';

/** Messages exchanged between the two browsers. Nothing here is ever stored on a server. */
export type Message =
  | { type: 'hello'; guestColor: 'w' | 'b'; pgn: string; variant: Variant }
  | { type: 'move'; san: string }
  | { type: 'illegal'; from: Square; to: Square }
  | { type: 'peek' }
  | { type: 'resign' }
  | { type: 'rematch-offer' }
  | { type: 'rematch-accept' }
  | { type: 'rematch-decline' };

export interface OnlineHandlers {
  onMessage(msg: Message): void;
  onOpen(): void;
  onClose(): void;
  onError(text: string): void;
}

const JOIN_PREFIX = '#join=';

/** Peer id of the host if this page was opened from an invite link. */
export function inviteIdFromUrl(): string | null {
  return location.hash.startsWith(JOIN_PREFIX) ? decodeURIComponent(location.hash.slice(JOIN_PREFIX.length)) : null;
}

export function inviteLink(peerId: string): string {
  return `${location.origin}${location.pathname}${JOIN_PREFIX}${encodeURIComponent(peerId)}`;
}

export class Online {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;

  constructor(private handlers: OnlineHandlers) {}

  /** Create a peer and wait for a friend to connect. Resolves with our peer id for the invite link. */
  host(): Promise<string> {
    this.close();
    const peer = new Peer();
    this.peer = peer;
    peer.on('connection', (conn) => {
      // Only one opponent per game; refuse anyone else who finds the link.
      if (this.conn?.open) {
        conn.on('open', () => conn.close());
        return;
      }
      this.attach(conn);
    });
    peer.on('error', (err) => this.handlers.onError(describeError(err.type)));
    return new Promise((resolve) => peer.on('open', resolve));
  }

  /** Connect to the host whose id came from the invite link. */
  join(hostId: string) {
    this.close();
    const peer = new Peer();
    this.peer = peer;
    peer.on('open', () => this.attach(peer.connect(hostId, { reliable: true })));
    peer.on('error', (err) => this.handlers.onError(describeError(err.type)));
  }

  send(msg: Message) {
    if (this.conn?.open) this.conn.send(msg);
  }

  get connected(): boolean {
    return !!this.conn?.open;
  }

  close() {
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
  }

  private attach(conn: DataConnection) {
    this.conn = conn;
    conn.on('open', () => this.handlers.onOpen());
    conn.on('data', (data) => this.handlers.onMessage(data as Message));
    conn.on('close', () => {
      if (this.conn === conn) this.handlers.onClose();
    });
    conn.on('error', () => this.handlers.onError('Connection error.'));
  }
}

function describeError(type: string): string {
  switch (type) {
    case 'peer-unavailable':
      return 'That game no longer exists — ask your friend for a new invite link.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the connection server. Check your internet connection.';
    case 'browser-incompatible':
      return 'This browser does not support peer-to-peer connections (WebRTC).';
    default:
      return `Connection problem (${type}).`;
  }
}
