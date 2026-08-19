/**
 * Making the alarms actually ring.
 *
 * A tick every few seconds is enough: alarms are minute-precise, and polling
 * beats scheduling timers that a restart would silently lose. An alarm that
 * rings keeps ringing until somebody stops it — that is the whole point of an
 * alarm.
 */

import type { Alarm } from '../../domain/alarm'
import type { AppEvent } from '../../domain/events'
import type { HardwarePort } from '../../ports/hardware'
import { isDue } from './alarmClock'
import type { AlarmService } from './alarmService'

/** How often the clock is checked. */
export const TICK_INTERVAL_MS = 10_000

/** How often the sound repeats while an alarm is ringing. */
export const REPEAT_INTERVAL_MS = 12_000

/**
 * How long an alarm rings with nobody answering before it gives up.
 *
 * Without this, an alarm that rang while the room was empty would hold the
 * scheduler forever and every later alarm would stay silent.
 */
export const MAX_RINGING_MS = 2 * 60 * 1000

/** Minutes added by the snooze button. */
export const SNOOZE_MINUTES = 5

export interface AlarmSchedulerDeps {
  alarms: AlarmService
  hardware: HardwarePort
  publish: (event: AppEvent) => void
  now: () => Date
  timezone: string
}

export class AlarmScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private ringing: Alarm | null = null
  private ringingSince = 0
  private lastAlertAt = 0

  constructor(private readonly deps: AlarmSchedulerDeps) {}

  /** The alarm currently ringing, if any. */
  get current(): Alarm | null {
    return this.ringing
  }

  /**
   * The event a client should receive to catch up on a ringing alarm.
   *
   * A kiosk that reloads mid-ring would otherwise never know, and the alarm
   * would keep making noise with no way on screen to stop it.
   */
  ringingEvent(): AppEvent | null {
    if (!this.ringing) {
      return null
    }
    return {
      type: 'alarm',
      state: 'ringing',
      alarmId: this.ringing.id,
      label: this.ringing.label,
      time: this.ringing.time,
    }
  }

  start(intervalMs = TICK_INTERVAL_MS): () => void {
    this.stop()
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        console.warn('alarm tick failed', error)
      })
    }, intervalMs)
    this.timer.unref?.()
    return () => this.stop()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** One pass of the clock. Exposed so the behaviour can be tested directly. */
  async tick(): Promise<void> {
    const now = this.deps.now()

    if (this.ringing) {
      await this.repeatAlert(now)
      return
    }

    const alarms = await this.deps.alarms.list()
    const due = alarms.find((alarm) => isDue(alarm, now, this.deps.timezone))
    if (due) {
      await this.ring(due, now)
    }
  }

  /** Stop the alarm that is ringing. */
  async dismiss(): Promise<void> {
    const alarm = this.ringing
    if (!alarm) {
      return
    }
    this.ringing = null
    this.ringingSince = 0
    this.lastAlertAt = 0
    await this.deps.hardware.stopSpeaking().catch(() => undefined)
    this.deps.publish({ type: 'alarm', state: 'stopped', alarmId: alarm.id })
  }

  /**
   * Stop ringing and come back in a few minutes.
   *
   * A fresh one-off alarm is created rather than reusing the original, so a
   * daily alarm keeps its own schedule.
   */
  async snooze(minutes = SNOOZE_MINUTES): Promise<void> {
    const alarm = this.ringing
    if (!alarm) {
      return
    }
    await this.dismiss()

    const later = new Date(this.deps.now().getTime() + minutes * 60_000)
    const time = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: this.deps.timezone,
    }).format(later)

    await this.deps.alarms.create({ time, label: alarm.label, repeat: 'once' })
  }

  private async ring(alarm: Alarm, now: Date): Promise<void> {
    this.ringing = alarm
    this.ringingSince = now.getTime()
    this.lastAlertAt = now.getTime()

    // Recorded immediately: a crash between ringing and dismissing must not
    // make the same alarm ring again on the next tick.
    await this.deps.alarms.markFired(alarm.id, now)

    this.deps.publish({
      type: 'alarm',
      state: 'ringing',
      alarmId: alarm.id,
      label: alarm.label,
      time: alarm.time,
    })

    await this.alert(alarm)
  }

  private async repeatAlert(now: Date): Promise<void> {
    // Nobody is coming: stop, so later alarms are not silenced by this one.
    if (now.getTime() - this.ringingSince > MAX_RINGING_MS) {
      console.info('alarm rang unanswered, stopping it')
      await this.dismiss()
      return
    }

    if (now.getTime() - this.lastAlertAt < REPEAT_INTERVAL_MS) {
      return
    }
    this.lastAlertAt = now.getTime()
    if (this.ringing) {
      await this.alert(this.ringing)
    }
  }

  private async alert(alarm: Alarm): Promise<void> {
    await this.deps.hardware.playSound('alert', { interrupt: true }).catch(() => undefined)
    await this.deps.hardware
      .speak(alarm.label === 'Alarme' ? 'C’est l’heure !' : `C’est l’heure : ${alarm.label}`)
      .catch(() => undefined)
    await this.deps.hardware.setExpression('wiggle').catch(() => undefined)
  }
}
