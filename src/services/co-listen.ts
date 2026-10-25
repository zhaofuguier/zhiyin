import { API_BASE_URL } from './config';
import { ApiRequestError, requestAuthenticatedJson, requestJson } from './network';

export type CoListenPlatform = 'wechat' | 'douyin';
export type CoListenPlaybackStatus = 'playing' | 'paused';

export interface CoListenParticipant {
  participantId: string;
  displayName: string;
  avatarUrl?: string;
  role: 'owner' | 'member';
  online: boolean;
}
export interface CoListenPlaybackState {
  status: CoListenPlaybackStatus;
  basePositionSeconds: number;
  serverTimestamp: string;
  revision: number;
}
export interface CoListenRoom {
  roomId: string;
  platform: CoListenPlatform;
  musicSpaceId: string;
  ownerParticipantId: string;
  participants: CoListenParticipant[];
  playback: CoListenPlaybackState;
  hardExpiresAt: string;
}
export interface CoListenCreatedRoom { inviteToken: string; selfParticipantId: string; room: CoListenRoom }
export interface CoListenJoinedRoom { selfParticipantId: string; room: CoListenRoom }
export interface CoListenCapability {
  enabled: boolean;
  supportedPlatforms: CoListenPlatform[];
  persistence: 'memory';
  maxParticipants: number;
}

export async function getCoListenCapability(): Promise<CoListenCapability> {
  const result = await requestJson<unknown>('/api/co-listen/capability', { method: 'GET', retryAuthentication: false });
  return requireCapability(result);
}
export async function createCoListenRoom(musicSpaceId: string): Promise<CoListenCreatedRoom> {
  const result = await requestAuthenticatedJson<unknown>('/api/co-listen/rooms', {
    method: 'POST', data: { musicSpaceId, nicknameSharingConsent: true }
  });
  return requireCreatedRoom(result);
}
export async function joinCoListenRoom(inviteToken: string, musicSpaceId: string): Promise<CoListenJoinedRoom> {
  const result = await requestAuthenticatedJson<unknown>('/api/co-listen/rooms/join', {
    method: 'POST', data: { inviteToken, musicSpaceId, nicknameSharingConsent: true }
  });
  return requireRoomEnvelope(result);
}
export async function leaveCoListenRoom(roomId: string): Promise<void> {
  await requestAuthenticatedJson(`/api/co-listen/rooms/${encodeURIComponent(roomId)}/leave`, { method: 'POST' });
}
export async function closeCoListenRoom(roomId: string): Promise<void> {
  await requestAuthenticatedJson(`/api/co-listen/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
}

interface SocketTaskLike {
  onOpen(callback: () => void): void;
  onMessage(callback: (event: { data: string | ArrayBuffer }) => void): void;
  onClose(callback: () => void): void;
  onError(callback: () => void): void;
  send(options: { data: string }): void;
  close(options?: { code?: number; reason?: string }): void;
}
export interface CoListenRealtimeEvent { event: 'room-state' | 'participant-list' | 'command-result' | 'error' | 'pong' | 'room-closed'; data: unknown }
export interface CoListenRealtimeDependencies {
  issueTicket(roomId: string): Promise<{ ticket: string; expiresAt: string }>;
  connect(url: string): SocketTaskLike;
  schedule(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
}

export class CoListenRealtimeClient {
  private socket: SocketTaskLike | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private attempts = 0;
  private roomId = '';
  private handler: ((event: CoListenRealtimeEvent) => void) | undefined;
  private commandSequence = 0;

  constructor(private readonly dependencies: CoListenRealtimeDependencies = defaultRealtimeDependencies()) {}

  async connect(roomId: string, handler: (event: CoListenRealtimeEvent) => void): Promise<void> {
    this.disconnect();
    this.stopped = false;
    this.roomId = roomId;
    this.handler = handler;
    this.attempts = 0;
    await this.open();
  }
  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) this.dependencies.cancel(this.reconnectTimer);
    if (this.heartbeatTimer) this.dependencies.cancel(this.heartbeatTimer);
    this.reconnectTimer = undefined;
    this.heartbeatTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close({ code: 1000, reason: 'page-hidden' });
  }
  command(type: 'play' | 'pause' | 'seek', expectedRevision: number, positionSeconds: number): void {
    if (!this.socket) throw new ApiRequestError(undefined, 'CO_LISTEN_SOCKET_NOT_READY');
    this.commandSequence += 1;
    this.socket.send({ data: JSON.stringify({ event: 'command', data: {
      type, expectedRevision, positionSeconds,
      commandId: `cmd_${Date.now().toString(36)}_${this.commandSequence.toString(36)}`
    } }) });
  }
  requestSync(): void { this.socket?.send({ data: JSON.stringify({ event: 'sync-request', data: {} }) }); }

  private async open(): Promise<void> {
    try {
      const ticket = await this.dependencies.issueTicket(this.roomId);
      if (this.stopped) return;
      const socket = this.dependencies.connect(coListenSocketUrl(ticket.ticket));
      this.socket = socket;
      socket.onOpen(() => { this.attempts = 0; this.requestSync(); this.scheduleHeartbeat(); });
      socket.onMessage((event) => this.receive(event.data));
      socket.onClose(() => this.reconnect());
      socket.onError(() => this.reconnect());
    } catch (error) {
      const closedReason = closedRoomReason(error);
      if (closedReason) {
        this.stopped = true;
        this.handler?.({ event: 'room-closed', data: { reason: closedReason } });
        return;
      }
      if (!this.stopped) this.reconnect(error);
    }
  }
  private reconnect(error?: unknown): void {
    if (this.stopped || this.reconnectTimer) return;
    if (this.heartbeatTimer) this.dependencies.cancel(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    this.socket = undefined;
    if (this.attempts >= 3) {
      this.handler?.({ event: 'error', data: { code: 'CO_LISTEN_RECONNECT_EXHAUSTED', cause: safeErrorCode(error) } });
      return;
    }
    const delay = [300, 900, 1800][this.attempts++] || 1800;
    this.reconnectTimer = this.dependencies.schedule(() => {
      this.reconnectTimer = undefined;
      void this.open();
    }, delay);
  }
  private receive(raw: string | ArrayBuffer): void {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    if (new TextEncoder().encode(text).byteLength > 16 * 1024) return;
    try {
      const value = JSON.parse(text) as { event?: unknown; data?: unknown };
      if (!['room-state', 'participant-list', 'command-result', 'error', 'pong', 'room-closed'].includes(String(value.event))) return;
      this.handler?.({ event: value.event as CoListenRealtimeEvent['event'], data: value.data });
    } catch {}
  }
  private scheduleHeartbeat(): void {
    if (this.stopped || !this.socket) return;
    if (this.heartbeatTimer) this.dependencies.cancel(this.heartbeatTimer);
    this.heartbeatTimer = this.dependencies.schedule(() => {
      this.heartbeatTimer = undefined;
      if (this.stopped || !this.socket) return;
      this.socket.send({ data: JSON.stringify({ event: 'ping', data: {} }) });
      this.scheduleHeartbeat();
    }, 25_000);
  }
}

export function coListenSocketUrl(ticket: string): string {
  const origin = new URL(API_BASE_URL);
  if (origin.protocol !== 'https:') throw new ApiRequestError(undefined, 'CO_LISTEN_SECURE_SOCKET_REQUIRED');
  origin.protocol = 'wss:';
  origin.pathname = '/api/co-listen/ws';
  origin.search = `?ticket=${encodeURIComponent(ticket)}`;
  return origin.toString();
}
export function expectedCoListenPosition(state: CoListenPlaybackState, now = Date.now()): number {
  const base = Math.max(0, state.basePositionSeconds);
  if (state.status !== 'playing') return base;
  const elapsed = Math.max(0, (now - Date.parse(state.serverTimestamp)) / 1000);
  return base + elapsed;
}
export function shouldCorrectCoListenDrift(localPosition: number, expectedPosition: number): boolean {
  return Math.abs(localPosition - expectedPosition) > 2;
}
export function coListenSharePath(musicSpaceId: string, inviteToken: string): string {
  return `/pages/player/index?musicSpaceId=${encodeURIComponent(musicSpaceId)}&listenInvite=${encodeURIComponent(inviteToken)}`;
}

function defaultRealtimeDependencies(): CoListenRealtimeDependencies {
  return {
    issueTicket: async (roomId) => {
      const value = await requestAuthenticatedJson<unknown>(`/api/co-listen/rooms/${encodeURIComponent(roomId)}/socket-ticket`, { method: 'POST' });
      if (!record(value) || typeof value.ticket !== 'string' || value.ticket.length < 22 || typeof value.expiresAt !== 'string') throw new ApiRequestError(502, 'CO_LISTEN_SOCKET_TICKET_INVALID');
      return { ticket: value.ticket, expiresAt: value.expiresAt };
    },
    connect: (url) => uni.connectSocket({ url }) as unknown as SocketTaskLike,
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: (timer) => clearTimeout(timer)
  };
}
function requireCreatedRoom(value: unknown): CoListenCreatedRoom {
  if (!record(value) || typeof value.inviteToken !== 'string' || value.inviteToken.length < 43 || typeof value.selfParticipantId !== 'string') throw new ApiRequestError(502, 'CO_LISTEN_RESPONSE_INVALID');
  return { inviteToken: value.inviteToken, selfParticipantId: value.selfParticipantId, room: requireRoom(value.room) };
}
function requireRoomEnvelope(value: unknown): CoListenJoinedRoom {
  if (!record(value) || typeof value.selfParticipantId !== 'string') throw new ApiRequestError(502, 'CO_LISTEN_RESPONSE_INVALID');
  return { selfParticipantId: value.selfParticipantId, room: requireRoom(value.room) };
}
export function requireRoom(value: unknown): CoListenRoom {
  if (!record(value) || typeof value.roomId !== 'string' || !['wechat', 'douyin'].includes(String(value.platform)) ||
      typeof value.musicSpaceId !== 'string' || typeof value.ownerParticipantId !== 'string' ||
      !Array.isArray(value.participants) || !record(value.playback) || typeof value.hardExpiresAt !== 'string' ||
      !Number.isFinite(Date.parse(value.hardExpiresAt))) {
    throw new ApiRequestError(502, 'CO_LISTEN_RESPONSE_INVALID');
  }
  const participants = value.participants.map(requireParticipant);
  const playback = value.playback;
  if (!['playing', 'paused'].includes(String(playback.status)) || typeof playback.basePositionSeconds !== 'number' ||
      typeof playback.serverTimestamp !== 'string' || !Number.isInteger(playback.revision)) throw new ApiRequestError(502, 'CO_LISTEN_RESPONSE_INVALID');
  return { roomId: value.roomId, platform: value.platform as CoListenPlatform, musicSpaceId: value.musicSpaceId,
    ownerParticipantId: value.ownerParticipantId, participants,
    playback: playback as unknown as CoListenPlaybackState, hardExpiresAt: value.hardExpiresAt };
}
function requireParticipant(value: unknown): CoListenParticipant {
  if (!record(value) || !exactKeys(value, ['participantId', 'displayName', 'avatarUrl', 'role', 'online']) ||
      typeof value.participantId !== 'string' || typeof value.displayName !== 'string' ||
      (value.avatarUrl !== undefined && typeof value.avatarUrl !== 'string') ||
      !['owner', 'member'].includes(String(value.role)) || typeof value.online !== 'boolean') throw new ApiRequestError(502, 'CO_LISTEN_RESPONSE_INVALID');
  return value as unknown as CoListenParticipant;
}
export function requireCoListenParticipants(value: unknown): CoListenParticipant[] {
  if (!Array.isArray(value) || value.length > 10) throw new ApiRequestError(502, 'CO_LISTEN_RESPONSE_INVALID');
  return value.map(requireParticipant);
}
function requireCapability(value: unknown): CoListenCapability {
  if (!record(value) || typeof value.enabled !== 'boolean' || value.persistence !== 'memory' ||
      !Array.isArray(value.supportedPlatforms) || value.supportedPlatforms.join(',') !== 'wechat,douyin' ||
      !Number.isInteger(value.maxParticipants)) throw new ApiRequestError(502, 'CO_LISTEN_RESPONSE_INVALID');
  return value as unknown as CoListenCapability;
}
function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function safeErrorCode(error: unknown): string { return error instanceof ApiRequestError ? error.code : 'CO_LISTEN_NETWORK_FAILED'; }
function closedRoomReason(error: unknown): 'hard-limit' | 'owner-disconnected' | 'idle' | 'owner-ended' | undefined {
  if (!(error instanceof ApiRequestError)) return undefined;
  const reasons: Readonly<Record<string, 'hard-limit' | 'owner-disconnected' | 'idle' | 'owner-ended'>> = {
    CO_LISTEN_ROOM_CLOSED_HARD_LIMIT: 'hard-limit',
    CO_LISTEN_ROOM_CLOSED_OWNER_DISCONNECTED: 'owner-disconnected',
    CO_LISTEN_ROOM_CLOSED_IDLE: 'idle',
    CO_LISTEN_ROOM_CLOSED_OWNER_ENDED: 'owner-ended'
  };
  return reasons[error.code];
}
