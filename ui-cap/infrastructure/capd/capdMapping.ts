/**
 * Translation between the daemon's wire format and the domain model.
 *
 * The daemon speaks snake_case Python; the interface speaks camelCase
 * TypeScript. Keeping the conversion pure and in one file means a field
 * renamed on either side breaks a test rather than a screen.
 */

import type { AppEvent } from '../../core/domain/events'
import type {
  Capabilities,
  CameraState,
  HardwareStatus,
  RecordingState,
  SpeakingState,
  TrackingState,
} from '../../core/domain/hardware'

type Raw = Record<string, unknown>

function asRecord(value: unknown): Raw {
  return typeof value === 'object' && value !== null ? (value as Raw) : {}
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toCapabilities(raw: Raw): Capabilities {
  const reasons = asRecord(raw.reasons)
  return {
    mock: asBoolean(raw.mock),
    camera: asBoolean(raw.camera),
    eyes: asBoolean(raw.eyes),
    servo: asBoolean(raw.servo),
    mic: asBoolean(raw.mic),
    speaker: asBoolean(raw.speaker),
    tts: asString(raw.tts, 'unknown'),
    reasons: Object.fromEntries(
      Object.entries(reasons).map(([key, value]) => [key, asString(value)]),
    ),
  }
}

function toCamera(raw: Raw): CameraState {
  return {
    available: asBoolean(raw.available),
    streaming: asBoolean(raw.streaming),
    vflip: asBoolean(raw.vflip),
    viewers: asNumber(raw.viewers),
    error: asNullableString(raw.error),
  }
}

function toTracking(raw: Raw): TrackingState {
  return {
    enabled: asBoolean(raw.enabled),
    active: asBoolean(raw.active),
    faceVisible: asBoolean(raw.face_visible),
  }
}

function toRecording(raw: Raw): RecordingState {
  const state: RecordingState = { active: asBoolean(raw.active) }
  if (typeof raw.recording_id === 'string') {
    state.recordingId = raw.recording_id
  }
  if (typeof raw.elapsed_s === 'number') {
    state.elapsedSeconds = raw.elapsed_s
  }
  return state
}

function toSpeaking(raw: Raw): SpeakingState {
  return {
    active: asBoolean(raw.active),
    queue: asNumber(raw.queue),
    utteranceId: asNullableString(raw.utterance_id),
    engine: asString(raw.engine, 'unknown'),
  }
}

/** Convert a `/status` payload into the domain model. */
export function toHardwareStatus(payload: unknown): HardwareStatus {
  const raw = asRecord(payload)
  return {
    mock: asBoolean(raw.mock),
    capabilities: toCapabilities(asRecord(raw.capabilities)),
    camera: toCamera(asRecord(raw.camera)),
    tracking: toTracking(asRecord(raw.tracking)),
    recording: toRecording(asRecord(raw.recording)),
    speaking: toSpeaking(asRecord(raw.speaking)),
  }
}

/**
 * Convert one daemon WebSocket message into an {@link AppEvent}.
 *
 * Unknown message types return null rather than throwing, so adding an event
 * to the daemon never breaks an interface that predates it.
 */
export function toAppEvent(message: unknown): AppEvent | null {
  const raw = asRecord(message)
  switch (raw.type) {
    case 'hello':
      return { type: 'hardware', online: true, status: toHardwareStatus(raw) }
    case 'face':
      return {
        type: 'face',
        visible: asBoolean(raw.visible),
        x: typeof raw.x === 'number' ? raw.x : null,
        y: typeof raw.y === 'number' ? raw.y : null,
      }
    case 'camera':
      return {
        type: 'camera',
        streaming: typeof raw.streaming === 'boolean' ? raw.streaming : undefined,
        vflip: typeof raw.vflip === 'boolean' ? raw.vflip : undefined,
        error: asNullableString(raw.error),
      }
    case 'tracking':
      return {
        type: 'tracking',
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : undefined,
        active: typeof raw.active === 'boolean' ? raw.active : undefined,
      }
    case 'recording': {
      const state = asString(raw.state)
      if (state !== 'started' && state !== 'stopped' && state !== 'cancelled') {
        return null
      }
      return {
        type: 'recording',
        state,
        recordingId: typeof raw.recording_id === 'string' ? raw.recording_id : undefined,
        durationSeconds: typeof raw.duration_s === 'number' ? raw.duration_s : undefined,
      }
    }
    case 'speaking': {
      const state = asString(raw.state)
      if (state !== 'started' && state !== 'finished' && state !== 'stopped' && state !== 'failed') {
        return null
      }
      return {
        type: 'speaking',
        state,
        utteranceId: typeof raw.utterance_id === 'string' ? raw.utterance_id : undefined,
        text: typeof raw.text === 'string' ? raw.text : undefined,
        kind: raw.kind === 'sound' ? 'sound' : raw.kind === 'speech' ? 'speech' : undefined,
      }
    }
    default:
      return null
  }
}
