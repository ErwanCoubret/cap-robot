'use client'

/**
 * Settings: the Flots connection, the camera, and a few hardware checks.
 *
 * Three columns so everything fits the panel without scrolling, and so the
 * camera preview can be watched while its orientation is being flipped.
 */

import { useCallback, useEffect, useState } from 'react'

import type { ConnectionTest, PairingInfo } from '../../core/domain/flots'
import { useApp } from '../deps/AppProvider'
import { CameraPreview } from './CameraPreview'
import { ConfirmSheet } from './ConfirmSheet'
import { ScreenHeader } from './ScreenHeader'
import { ToggleRow } from './ToggleRow'
import { BigButton, Card } from './touch'

const STATUS_LABELS: Record<PairingInfo['status'], string> = {
  paired: 'Connecté',
  unpaired: 'Non appairé',
  pending: 'Appairage en cours',
  expired: 'Connexion expirée',
}

export function SettingsScreen({
  paired,
  pairingError,
}: {
  paired?: boolean
  pairingError?: string
}) {
  const { hardware, refresh } = useApp()
  const status = hardware.status

  const [pairing, setPairing] = useState<PairingInfo | null>(null)
  const [test, setTest] = useState<ConnectionTest | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [message, setMessage] = useState<string | null>(
    pairingError ?? (paired ? 'Robot appairé à Flots.' : null),
  )

  const loadPairing = useCallback(async () => {
    try {
      const response = await fetch('/api/pairing', { cache: 'no-store' })
      setPairing((await response.json()) as PairingInfo)
    } catch {
      setPairing(null)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves, not synchronously
    void loadPairing()
  }, [loadPairing])

  const startPairing = async () => {
    setBusy('pair')
    setMessage(null)
    try {
      const response = await fetch('/api/pairing', { method: 'POST' })
      const body = (await response.json()) as { authorizeUrl?: string; error?: string }
      if (body.authorizeUrl) {
        // Leaving the kiosk for the Flots login page is the whole point: the
        // consent screen needs a real Flots session.
        window.location.href = body.authorizeUrl
        return
      }
      setMessage(body.error ?? 'Appairage impossible.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Appairage impossible.')
    } finally {
      setBusy(null)
    }
  }

  const runTest = async () => {
    setBusy('test')
    setTest(null)
    try {
      const response = await fetch('/api/pairing/test', { method: 'POST' })
      setTest((await response.json()) as ConnectionTest)
    } catch (error) {
      setTest({
        ok: false,
        user: null,
        scopes: [],
        toolCount: 0,
        latencyMs: 0,
        error: error instanceof Error ? error.message : 'test impossible',
      })
    } finally {
      setBusy(null)
    }
  }

  const resetPairing = async () => {
    setConfirmReset(false)
    setBusy('reset')
    setTest(null)
    try {
      await fetch('/api/pairing', { method: 'DELETE' })
      setMessage('Connexion Flots réinitialisée.')
      await loadPairing()
    } finally {
      setBusy(null)
    }
  }

  const updateCamera = async (patch: { vflip?: boolean; tracking?: boolean }) => {
    setBusy('camera')
    try {
      await fetch('/api/camera/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const runHardwareCheck = async (kind: 'voice' | 'eyes') => {
    setBusy(kind)
    try {
      await fetch('/api/hardware/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      })
    } finally {
      setBusy(null)
    }
  }

  const pairingStatus = pairing?.status ?? 'unpaired'
  const connected = pairingStatus === 'paired'

  return (
    <main className="flex h-screen w-screen flex-col gap-2 p-2">
      <ScreenHeader title="Réglages" subtitle={message ?? pairing?.baseUrl ?? undefined} />

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_264px] gap-2">
        <div className="flex min-h-0 flex-col gap-2">
          <Card className="flex flex-col gap-2 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xl font-bold text-title-blue">Connexion Flots</h2>
              <p
                className={`text-base font-semibold ${
                  connected ? 'text-green-main' : 'text-red-main'
                }`}
              >
                {STATUS_LABELS[pairingStatus]}
              </p>
            </div>

            <p className="truncate text-sm text-gray-main">
              {pairing?.user?.email ?? (connected ? 'compte inconnu' : 'aucun compte connecté')}
              {connected && typeof pairing?.daysRemaining === 'number'
                ? ` · expire dans ${pairing.daysRemaining} j`
                : ''}
              {test
                ? test.ok
                  ? ` · ${test.toolCount} outils en ${test.latencyMs} ms`
                  : ` · ${test.error ?? 'échec du test'}`
                : ''}
            </p>

            <div className="flex gap-2">
              <BigButton
                label={busy === 'test' ? 'Test…' : 'Tester'}
                icon="refresh"
                tone="neutral"
                size="compact"
                onClick={runTest}
                disabled={busy !== null}
                className="flex-1"
              />
              <BigButton
                label={connected ? 'Ré-appairer' : 'Appairer'}
                icon="link"
                tone="primary"
                size="compact"
                onClick={startPairing}
                disabled={busy !== null}
                className="flex-1"
              />
              <BigButton
                label="Réinitialiser"
                icon="trash"
                tone="danger"
                size="compact"
                onClick={() => setConfirmReset(true)}
                disabled={busy !== null || pairingStatus === 'unpaired'}
                className="flex-1"
              />
            </div>
          </Card>

          <Card className="flex min-h-0 flex-1 flex-col gap-2 p-3">
            <h2 className="text-xl font-bold text-title-blue">Système</h2>
            <ul className="grid grid-cols-6 gap-x-2 text-xs">
              <HealthLine label="Corps" ok={hardware.online} />
              <HealthLine label="Micro" ok={status?.capabilities.mic ?? false} />
              <HealthLine label="Voix" ok={status?.capabilities.speaker ?? false} />
              <HealthLine label="Yeux" ok={status?.capabilities.eyes ?? false} />
              <HealthLine label="Caméra" ok={status?.camera.available ?? false} />
              <HealthLine label="Servos" ok={false} />
            </ul>
            <div className="mt-auto flex gap-2">
              <BigButton
                label="Test voix"
                icon="speaker"
                tone="neutral"
                size="compact"
                onClick={() => void runHardwareCheck('voice')}
                disabled={busy !== null || !hardware.online}
                className="flex-1"
              />
              <BigButton
                label="Test yeux"
                icon="camera"
                tone="neutral"
                size="compact"
                onClick={() => void runHardwareCheck('eyes')}
                disabled={busy !== null || !hardware.online}
                className="flex-1"
              />
            </div>
          </Card>
        </div>

        <Card className="flex min-h-0 flex-col gap-2 p-3">
          <h2 className="text-xl font-bold text-title-blue">Caméra</h2>
          <CameraPreview available={status?.camera.available ?? false} />
          <div className="mt-auto flex gap-2">
            <ToggleRow
              label="Retourner"
              hint="Monté à l'envers"
              checked={status?.camera.vflip ?? false}
              disabled={busy !== null || !status?.camera.available}
              onChange={(next) => void updateCamera({ vflip: next })}
              onLabel="Oui"
              offLabel="Non"
              stacked
            />
            <ToggleRow
              label="Suivi"
              hint="Du visage"
              checked={status?.tracking.enabled ?? false}
              disabled={busy !== null || !status?.camera.available}
              onChange={(next) => void updateCamera({ tracking: next })}
              onLabel="Oui"
              offLabel="Non"
              stacked
            />
          </div>
        </Card>
      </div>

      {confirmReset ? (
        <ConfirmSheet
          title="Réinitialiser la connexion Flots ?"
          body="Cap oubliera le compte connecté. Il faudra refaire l'appairage pour créer des tâches ou des notes."
          confirmLabel="Réinitialiser"
          onConfirm={() => void resetPairing()}
          onCancel={() => setConfirmReset(false)}
        />
      ) : null}
    </main>
  )
}

function HealthLine({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`h-3 w-3 shrink-0 rounded-full ${ok ? 'bg-green-main' : 'bg-gray-sec'}`} />
      <span className="truncate font-medium">{label}</span>
      {detail ? <span className="truncate text-xs text-gray-main">{detail}</span> : null}
    </li>
  )
}
