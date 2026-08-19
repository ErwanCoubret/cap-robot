/**
 * Client for the hardware daemon.
 *
 * Holds one WebSocket open for events and issues plain HTTP for commands. The
 * daemon may be down (developing off-device, a failed service) and that is a
 * normal state, not an error: health() reports it and the interface degrades.
 */

import type { AppEvent } from '../../core/domain/events'
import type { HardwareHealth, HardwareStatus } from '../../core/domain/hardware'
import {
  HardwareUnavailableError,
  type ExpressionName,
  type HardwarePort,
  type RecordingResult,
  type SoundName,
} from '../../core/ports/hardware'
import type { EventBus } from '../events/eventBus'
import { toAppEvent, toHardwareStatus } from './capdMapping'

/** Reconnection backoff bounds for the event socket. */
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 15_000

/** Commands are local and should answer immediately; never hang the UI. */
const REQUEST_TIMEOUT_MS = 10_000

export interface CapdClientOptions {
  baseUrl: string
  events: EventBus
  /** Disable the socket in tests. */
  autoConnect?: boolean
}

export class CapdClient implements HardwarePort {
  private readonly baseUrl: string
  private readonly events: EventBus
  private socket: WebSocket | null = null
  private reconnectDelay = RECONNECT_MIN_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private online = false
  private status: HardwareStatus | null = null

  constructor(options: CapdClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.events = options.events
    if (options.autoConnect !== false) {
      this.connect()
    }
  }

  /** URL of the MJPEG preview, proxied by the interface's own route. */
  get previewUrl(): string {
    return `${this.baseUrl}/camera/preview`
  }

  /** URL of a single preview frame. */
  get snapshotUrl(): string {
    return `${this.baseUrl}/camera/snapshot`
  }

  lastStatus(): HardwareStatus | null {
    return this.status
  }

  async health(): Promise<HardwareHealth> {
    try {
      const status = toHardwareStatus(await this.request('GET', '/status'))
      this.status = status
      return { online: true, status }
    } catch (error) {
      return {
        online: false,
        status: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async startRecording(maxSeconds?: number): Promise<string> {
    const body = await this.request('POST', '/record/start', {
      max_seconds: maxSeconds ?? null,
    })
    return String((body as { recording_id?: string }).recording_id ?? '')
  }

  async stopRecording(): Promise<RecordingResult> {
    const body = (await this.request('POST', '/record/stop', {})) as {
      recording_id: string
      duration_s: number
      path: string
    }
    return {
      recordingId: body.recording_id,
      durationSeconds: body.duration_s,
      path: body.path,
    }
  }

  async cancelRecording(): Promise<void> {
    await this.request('POST', '/record/cancel', {})
  }

  async readRecording(recordingId: string): Promise<ArrayBuffer> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/record/${encodeURIComponent(recordingId)}/file`,
      { method: 'GET' },
    )
    if (!response.ok) {
      throw new HardwareUnavailableError(
        `could not read recording ${recordingId} (HTTP ${response.status})`,
      )
    }
    return response.arrayBuffer()
  }

  async speak(text: string, options: { interrupt?: boolean } = {}): Promise<string> {
    const body = await this.request('POST', '/speak', {
      text,
      interrupt: options.interrupt ?? false,
    })
    return String((body as { utterance_id?: string }).utterance_id ?? '')
  }

  async stopSpeaking(): Promise<void> {
    await this.request('POST', '/speak/stop', {})
  }

  async playSound(name: SoundName, options: { interrupt?: boolean } = {}): Promise<void> {
    await this.request('POST', '/sound', {
      name,
      interrupt: options.interrupt ?? false,
    })
  }

  async setExpression(name: ExpressionName, durationMs?: number): Promise<void> {
    await this.request('POST', '/eyes/expression', {
      name,
      duration_ms: durationMs ?? null,
    })
  }

  async setTracking(enabled: boolean): Promise<void> {
    await this.request('POST', '/camera/settings', { tracking: enabled })
  }

  async setCameraFlip(vflip: boolean): Promise<void> {
    await this.request('POST', '/camera/settings', { vflip })
  }

  /** Open the event socket and keep it open, retrying with backoff. */
  connect(): void {
    if (this.closed || this.socket) {
      return
    }

    const url = `${this.baseUrl.replace(/^http/, 'ws')}/events`
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_MS
      this.setOnline(true)
    }

    socket.onmessage = (message) => {
      let payload: unknown
      try {
        payload = JSON.parse(String(message.data))
      } catch {
        return
      }
      const event = toAppEvent(payload)
      if (!event) {
        return
      }
      if (event.type === 'hardware' && event.status) {
        this.status = event.status
      }
      this.publish(event)
    }

    socket.onerror = () => {
      // Errors are always followed by close; reconnection is handled there.
    }

    socket.onclose = () => {
      this.socket = null
      this.setOnline(false)
      this.scheduleReconnect()
    }
  }

  /** Stop reconnecting and close the socket. */
  disconnect(): void {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket?.close()
    this.socket = null
  }

  private setOnline(online: boolean): void {
    if (this.online === online) {
      return
    }
    this.online = online
    if (!online) {
      this.status = null
    }
    this.publish({ type: 'hardware', online, status: this.status })
  }

  private publish(event: AppEvent): void {
    this.events.publish(event)
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) {
      return
    }
    const delay = this.reconnectDelay
    this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
    // A pending reconnect must not hold the process open.
    this.reconnectTimer.unref?.()
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new HardwareUnavailableError(
        `capd ${method} ${path} failed (HTTP ${response.status}) ${detail}`.trim(),
      )
    }
    return response.json().catch(() => ({}))
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch (error) {
      throw new HardwareUnavailableError(
        `capd unreachable at ${this.baseUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
