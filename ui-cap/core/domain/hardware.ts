/**
 * Hardware state as reported by the daemon.
 *
 * Everything here is optional in spirit: the robot must render correctly with
 * no camera, no eyes, no speaker, or no daemon at all.
 */

/** What the daemon found on the machine at boot. */
export interface Capabilities {
  mock: boolean
  camera: boolean
  eyes: boolean
  servo: boolean
  mic: boolean
  speaker: boolean
  /** Speech engine in use, e.g. `supertonic` or `mock`. */
  tts: string
  /** Human-readable explanation per missing part. */
  reasons: Record<string, string>
}

/** Camera ownership and orientation. */
export interface CameraState {
  available: boolean
  streaming: boolean
  vflip: boolean
  viewers: number
  error: string | null
}

/** Face-following state. */
export interface TrackingState {
  enabled: boolean
  active: boolean
  faceVisible: boolean
}

/** Voice capture state. */
export interface RecordingState {
  active: boolean
  recordingId?: string
  elapsedSeconds?: number
}

/** Speech queue state. */
export interface SpeakingState {
  active: boolean
  queue: number
  utteranceId: string | null
  engine: string
}

/** The full daemon status. */
export interface HardwareStatus {
  mock: boolean
  capabilities: Capabilities
  camera: CameraState
  tracking: TrackingState
  recording: RecordingState
  speaking: SpeakingState
}

/** Connection to the daemon, including the case where it is not running. */
export interface HardwareHealth {
  online: boolean
  status: HardwareStatus | null
  error?: string
}
