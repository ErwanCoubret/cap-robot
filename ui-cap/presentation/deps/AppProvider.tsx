'use client'

/**
 * Client-side dependency container.
 *
 * Mirrors the Flots frontend's approach — one context holding everything the
 * screens need — adapted to the robot: the state it carries is fed by the
 * server's event stream rather than by local stores.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { AppEvent } from '../../core/domain/events'
import type { HardwareHealth } from '../../core/domain/hardware'
import { useAppEvents } from '../hooks/useAppEvents'

/** Live view of the robot's body. */
export interface RobotState {
  hardware: HardwareHealth
  faceVisible: boolean
  speaking: boolean
  recording: boolean
  /** False until the first status arrives, so screens can show a skeleton. */
  ready: boolean
}

export interface AppContextValue extends RobotState {
  /** Listen to raw events, for screens driving their own state machine. */
  onEvent: (listener: (event: AppEvent) => void) => () => void
  /** Re-read the aggregated status from the server. */
  refresh: () => Promise<void>
  timezone: string
  locale: string
}

const INITIAL: RobotState = {
  hardware: { online: false, status: null },
  faceVisible: false,
  speaking: false,
  recording: false,
  ready: false,
}

const AppContext = createContext<AppContextValue>({
  ...INITIAL,
  onEvent: () => () => undefined,
  refresh: async () => undefined,
  timezone: 'Europe/Paris',
  locale: 'fr',
})

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RobotState>(INITIAL)
  const [settings, setSettings] = useState({ timezone: 'Europe/Paris', locale: 'fr' })
  const listeners = useRef(new Set<(event: AppEvent) => void>())

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/status', { cache: 'no-store' })
      const body = (await response.json()) as {
        hardware: HardwareHealth
        timezone?: string
        locale?: string
      }
      setState((current) => ({
        ...current,
        hardware: body.hardware,
        ready: true,
        speaking: body.hardware.status?.speaking.active ?? current.speaking,
        recording: body.hardware.status?.recording.active ?? current.recording,
        faceVisible: body.hardware.status?.tracking.faceVisible ?? current.faceVisible,
      }))
      setSettings({
        timezone: body.timezone ?? 'Europe/Paris',
        locale: body.locale ?? 'fr',
      })
    } catch {
      setState((current) => ({ ...current, ready: true }))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useAppEvents(
    useCallback((event: AppEvent) => {
      setState((current) => reduce(current, event))
      for (const listener of [...listeners.current]) {
        listener(event)
      }
    }, []),
  )

  const onEvent = useCallback((listener: (event: AppEvent) => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const value = useMemo<AppContextValue>(
    () => ({ ...state, ...settings, onEvent, refresh }),
    [state, settings, onEvent, refresh],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

/** Access the robot state and the shared dependencies. */
export function useApp(): AppContextValue {
  return useContext(AppContext)
}

function reduce(state: RobotState, event: AppEvent): RobotState {
  switch (event.type) {
    case 'hardware':
      return {
        ...state,
        ready: true,
        hardware: { online: event.online, status: event.status ?? null },
      }
    case 'face':
      return { ...state, faceVisible: event.visible }
    case 'recording':
      return { ...state, recording: event.state === 'started' }
    case 'speaking':
      return { ...state, speaking: event.state === 'started' }
    default:
      return state
  }
}
