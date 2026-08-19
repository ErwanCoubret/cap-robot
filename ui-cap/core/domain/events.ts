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
  | PingEvent

/** Narrow an unknown payload coming off the wire into an {@link AppEvent}. */
export function isAppEvent(value: unknown): value is AppEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}
