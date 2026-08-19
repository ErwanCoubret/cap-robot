/**
 * Events pushed from the server to the interface.
 *
 * The kiosk holds a single event stream and reacts to it; commands are plain
 * POSTs that return an identifier. Keeping every state transition on one
 * channel is what lets overlays stay in sync with work happening server-side.
 */

import type { CameraState, HardwareStatus, TrackingState } from './hardware'

/** The daemon connection came up or went down. */
export interface HardwareOnlineEvent {
  type: 'hardware'
  online: boolean
  status?: HardwareStatus | null
}

/** A face entered or left the camera's view. */
export interface FaceEvent {
  type: 'face'
  visible: boolean
  x: number | null
  y: number | null
}

/** Camera ownership or orientation changed. */
export interface CameraEvent {
  type: 'camera'
  streaming?: boolean
  vflip?: boolean
  error?: string | null
}

/** Face following was turned on or off. */
export interface TrackingEvent {
  type: 'tracking'
  enabled?: boolean
  active?: boolean
}

/** Microphone capture lifecycle. */
export interface RecordingEvent {
  type: 'recording'
  state: 'started' | 'stopped' | 'cancelled'
  recordingId?: string
  durationSeconds?: number
}

/** Speech lifecycle. */
export interface SpeakingEvent {
  type: 'speaking'
  state: 'started' | 'finished' | 'stopped' | 'failed'
  utteranceId?: string
  text?: string
  kind?: 'speech' | 'sound'
}

/** Progress of a voice interaction, from the tap to the spoken answer. */
export interface VoiceEvent {
  type: 'voice'
  interactionId: string
  mode: 'note' | 'command'
  state:
    | 'recording'
    | 'transcribing'
    | 'saving'
    | 'thinking'
    | 'speaking'
    | 'done'
    | 'cancelled'
    | 'error'
  /** What the user said, once it has been transcribed. */
  transcript?: string
  /** What Cap is doing or answering, in words the user can read. */
  message?: string
  error?: string
}

/** Progress of an agent turn, step by step. */
export interface AgentEvent {
  type: 'agent'
  turnId: string
  state: 'started' | 'tool' | 'tool_result' | 'message' | 'finished' | 'error'
  /** Tool being called, on `tool` and `tool_result`. */
  tool?: string
  /** What Cap is doing, phrased for the screen. */
  label?: string
  /** Whether the tool call succeeded, on `tool_result`. */
  ok?: boolean
  /** Cap's answer, on `message` and `finished`. */
  text?: string
  error?: string
}

/** The cached view of the user's day was refreshed. */
export interface DayEvent {
  type: 'day'
  syncedAt: string | null
  taskCount: number
  overdueCount: number
}

/** An alarm started or stopped ringing. */
export interface AlarmEvent {
  type: 'alarm'
  state: 'ringing' | 'stopped'
  alarmId: string
  label?: string
  time?: string
}

/** A message worth surfacing on screen, and possibly out loud. */
export interface NotificationEvent {
  type: 'notification'
  id: string
  title: string
  body: string
  level: 'info' | 'warning'
}

/** Keep-alive so a proxy does not close an idle stream. */
export interface PingEvent {
  type: 'ping'
}

/** Anything the interface may receive. */
export type AppEvent =
  | HardwareOnlineEvent
  | FaceEvent
  | CameraEvent
  | TrackingEvent
  | RecordingEvent
  | SpeakingEvent
  | VoiceEvent
  | AgentEvent
  | DayEvent
  | AlarmEvent
  | NotificationEvent
  | PingEvent

/** Narrow an unknown payload coming off the wire into an {@link AppEvent}. */
export function isAppEvent(value: unknown): value is AppEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}
