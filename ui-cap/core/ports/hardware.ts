/**
 * Port to the robot's physical body.
 *
 * Use cases depend on this interface, never on the daemon's HTTP shape, so the
 * agent and the voice pipeline can be tested with a fake body.
 */

import type { HardwareHealth, HardwareStatus } from '../domain/hardware'

/** A finished microphone capture. */
export interface RecordingResult {
  recordingId: string
  durationSeconds: number
  path: string
}

/** Named eye animations the daemon knows how to play. */
export type ExpressionName =
  | 'center'
  | 'happy'
  | 'thinking'
  | 'listening'
  | 'look_left'
  | 'look_right'
  | 'wiggle'

/** Named notification sounds. */
export type SoundName = 'chime' | 'alert' | 'error' | 'listening'

/** Everything the robot's body can be asked to do. */
export interface HardwarePort {
  /** Current daemon health, never throwing when the daemon is down. */
  health(): Promise<HardwareHealth>

  /** Latest known status without hitting the network, if one was seen. */
  lastStatus(): HardwareStatus | null

  startRecording(maxSeconds?: number): Promise<string>
  stopRecording(): Promise<RecordingResult>
  cancelRecording(): Promise<void>

  /** Fetch a finished capture's audio for transcription. */
  readRecording(recordingId: string): Promise<ArrayBuffer>

  speak(text: string, options?: { interrupt?: boolean }): Promise<string>
  stopSpeaking(): Promise<void>
  playSound(name: SoundName, options?: { interrupt?: boolean }): Promise<void>

  setExpression(name: ExpressionName, durationMs?: number): Promise<void>
  setTracking(enabled: boolean): Promise<void>
  setCameraFlip(vflip: boolean): Promise<void>
}

/** Raised when the daemon cannot be reached or refuses a command. */
export class HardwareUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HardwareUnavailableError'
  }
}
