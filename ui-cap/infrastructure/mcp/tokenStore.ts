/**
 * Where the Flots credential lives on the robot.
 *
 * The file holds a bearer token that can create and delete the user's tasks
 * and notes, so it is written with owner-only permissions and never leaves
 * this process.
 */

import { join } from 'node:path'

import type { PairedUser, PairingInfo, PairingStatus } from '../../core/domain/flots'
import { JsonStore, PRIVATE_FILE_MODE } from '../store/jsonStore'

/** Pending authorisation attempt, kept between the redirect and the callback. */
export interface PendingAuthorization {
  verifier: string
  state: string
  redirectUri: string
  tokenEndpoint: string
  resource: string
  createdAt: string
}

export interface PairingRecord {
  clientId: string | null
  /** Redirect URI the client was registered with. */
  redirectUri: string | null
  accessToken: string | null
  scopes: string[]
  obtainedAt: string | null
  expiresIn: number | null
  user: PairedUser | null
  pending: PendingAuthorization | null
  /** Set when Flots last rejected the token, so the UI can say "re-pair". */
  unauthorizedAt: string | null
}

const EMPTY: PairingRecord = {
  clientId: null,
  redirectUri: null,
  accessToken: null,
  scopes: [],
  obtainedAt: null,
  expiresIn: null,
  user: null,
  pending: null,
  unauthorizedAt: null,
}

/** A pending authorisation older than this is abandoned. */
export const PENDING_TTL_MS = 15 * 60 * 1000

/** Tokens last 30 days when the server does not say otherwise. */
export const DEFAULT_TOKEN_TTL_SECONDS = 30 * 24 * 3600

export class TokenStore {
  private readonly store: JsonStore<PairingRecord>

  constructor(dataDir: string) {
    this.store = new JsonStore<PairingRecord>(join(dataDir, 'flots-pairing.json'), EMPTY, {
      mode: PRIVATE_FILE_MODE,
    })
  }

  read(): Promise<PairingRecord> {
    return this.store.read()
  }

  update(mutate: (current: PairingRecord) => PairingRecord): Promise<PairingRecord> {
    return this.store.update(mutate)
  }

  /** Forget everything: token, client registration and any pending attempt. */
  async reset(): Promise<void> {
    await this.store.write({ ...EMPTY })
  }
}

/** Compute when the stored token stops being valid. */
export function expiresAt(record: PairingRecord): Date | null {
  if (!record.obtainedAt) {
    return null
  }
  const obtained = new Date(record.obtainedAt).getTime()
  if (Number.isNaN(obtained)) {
    return null
  }
  const ttl = (record.expiresIn ?? DEFAULT_TOKEN_TTL_SECONDS) * 1000
  return new Date(obtained + ttl)
}

/**
 * Derive the state shown to the user.
 *
 * A token past its lifetime, or one Flots has already rejected, both mean the
 * same thing on screen: the robot has to be paired again.
 */
export function describePairing(
  record: PairingRecord,
  baseUrl: string,
  now: Date = new Date(),
): PairingInfo {
  const expiry = expiresAt(record)
  const daysRemaining = expiry
    ? Math.floor((expiry.getTime() - now.getTime()) / (24 * 3600 * 1000))
    : null

  let status: PairingStatus = 'unpaired'
  if (record.accessToken) {
    const expired = expiry !== null && expiry.getTime() <= now.getTime()
    status = expired || record.unauthorizedAt ? 'expired' : 'paired'
  } else if (record.pending && !isPendingStale(record.pending, now)) {
    status = 'pending'
  }

  return {
    status,
    user: record.user,
    scopes: record.scopes,
    expiresAt: expiry ? expiry.toISOString() : null,
    daysRemaining,
    baseUrl,
  }
}

/** Whether a pending attempt is too old to be completed. */
export function isPendingStale(
  pending: PendingAuthorization,
  now: Date = new Date(),
): boolean {
  const created = new Date(pending.createdAt).getTime()
  if (Number.isNaN(created)) {
    return true
  }
  return now.getTime() - created > PENDING_TTL_MS
}
