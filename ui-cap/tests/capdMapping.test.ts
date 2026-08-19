import { describe, expect, it } from 'vitest'

import { toAppEvent, toHardwareStatus } from '../infrastructure/capd/capdMapping'

/** A realistic payload, matching what the daemon serves in mock mode. */
const STATUS_PAYLOAD = {
  mock: true,
  capabilities: {
    mock: true,
    camera: true,
    eyes: true,
    servo: false,
    mic: true,
    speaker: true,
    tts: 'mock',
    reasons: { servo: 'servos are not wired up yet' },
  },
  camera: { available: true, streaming: false, vflip: false, viewers: 0, error: null },
  tracking: { enabled: true, active: true, face_visible: false },
  recording: { active: true, recording_id: 'rec_abc', elapsed_s: 2.5 },
  speaking: { active: false, queue: 0, utterance_id: null, engine: 'mock' },
}

describe('toHardwareStatus', () => {
  it('maps the daemon payload into the domain model', () => {
    const status = toHardwareStatus(STATUS_PAYLOAD)

    expect(status.capabilities.servo).toBe(false)
    expect(status.tracking.faceVisible).toBe(false)
    expect(status.recording).toEqual({
      active: true,
      recordingId: 'rec_abc',
      elapsedSeconds: 2.5,
    })
    expect(status.speaking.engine).toBe('mock')
  })

  it('survives a truncated or empty payload', () => {
    const status = toHardwareStatus({})

    expect(status.capabilities.camera).toBe(false)
    expect(status.camera.error).toBeNull()
    expect(status.recording.active).toBe(false)
  })

  it('ignores values of the wrong type instead of propagating them', () => {
    const status = toHardwareStatus({ mock: 'yes', speaking: { queue: 'lots' } })

    expect(status.mock).toBe(false)
    expect(status.speaking.queue).toBe(0)
  })
})

describe('toAppEvent', () => {
  it('turns the greeting into a hardware event carrying the status', () => {
    const event = toAppEvent({ type: 'hello', ...STATUS_PAYLOAD })

    expect(event).toMatchObject({ type: 'hardware', online: true })
    expect(event && 'status' in event && event.status?.capabilities.mic).toBe(true)
  })

  it('maps face detections', () => {
    expect(toAppEvent({ type: 'face', visible: true, x: 120, y: 90 })).toEqual({
      type: 'face',
      visible: true,
      x: 120,
      y: 90,
    })
  })

  it('maps a face that left the frame, where coordinates are absent', () => {
    expect(toAppEvent({ type: 'face', visible: false, x: null, y: null })).toEqual({
      type: 'face',
      visible: false,
      x: null,
      y: null,
    })
  })

  it('renames the recording fields', () => {
    expect(
      toAppEvent({
        type: 'recording',
        state: 'stopped',
        recording_id: 'rec_1',
        duration_s: 4,
      }),
    ).toEqual({
      type: 'recording',
      state: 'stopped',
      recordingId: 'rec_1',
      durationSeconds: 4,
    })
  })

  it('maps speech lifecycle events', () => {
    expect(
      toAppEvent({ type: 'speaking', state: 'started', utterance_id: 'utt_1', kind: 'speech', text: 'Bonjour' }),
    ).toEqual({
      type: 'speaking',
      state: 'started',
      utteranceId: 'utt_1',
      kind: 'speech',
      text: 'Bonjour',
    })
  })

  it('drops events with an unknown state rather than passing them on', () => {
    expect(toAppEvent({ type: 'recording', state: 'exploded' })).toBeNull()
    expect(toAppEvent({ type: 'speaking', state: 'humming' })).toBeNull()
  })

  it('ignores event types it does not know', () => {
    // Adding an event to the daemon must never break an older interface.
    expect(toAppEvent({ type: 'telemetry', value: 1 })).toBeNull()
    expect(toAppEvent('nonsense')).toBeNull()
  })
})
