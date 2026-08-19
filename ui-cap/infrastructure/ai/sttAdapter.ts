/**
 * Turning a recording into text.
 *
 * Every supported provider exposes Whisper through the OpenAI transcription
 * endpoint, so one adapter covers the hosted ones and the local model that is
 * on its way — only the base URL changes.
 */

import OpenAI, { toFile } from 'openai'

import type { SttPort, Transcript } from '../../core/ports/ai'
import { AiUnavailableError } from '../../core/ports/ai'
import { describeProvider, isUsable, type ProviderDescriptor } from './providers'
import { withRetry } from './retry'

/** Transcription is slower than a chat turn, and the user is waiting. */
const REQUEST_TIMEOUT_MS = 120_000

/** Default spoken language; Cap speaks French. */
const DEFAULT_LANGUAGE = 'fr'

export class SttAdapter implements SttPort {
  private readonly client: OpenAI | null

  constructor(private readonly provider: ProviderDescriptor) {
    this.client =
      provider.name === 'mock'
        ? null
        : new OpenAI({
            baseURL: provider.baseUrl,
            apiKey: provider.credential ?? 'missing',
            maxRetries: 0,
            timeout: REQUEST_TIMEOUT_MS,
          })
  }

  get label(): string {
    return this.provider.name === 'mock'
      ? this.provider.label
      : `${this.provider.label} · ${this.provider.model}`
  }

  get available(): boolean {
    return isUsable(this.provider)
  }

  /** One-line description for the boot log. */
  describe(): string {
    return describeProvider(this.provider)
  }

  async transcribe(
    audio: ArrayBuffer,
    options: { language?: string } = {},
  ): Promise<Transcript> {
    if (this.provider.name === 'mock') {
      return { text: mockTranscript(audio), label: this.label }
    }

    if (!this.available) {
      throw new AiUnavailableError(
        `${this.provider.label} n’est pas configuré (${this.provider.credentialVariable} manquant)`,
      )
    }

    const client = this.client as OpenAI
    const response = await withRetry(
      async () => {
        // A fresh handle per attempt: an upload stream cannot be replayed.
        const file = await toFile(Buffer.from(audio), 'cap-recording.wav', {
          type: 'audio/wav',
        })
        return client.audio.transcriptions.create({
          file,
          model: this.provider.model,
          language: options.language ?? DEFAULT_LANGUAGE,
          temperature: 0,
          response_format: 'json',
        })
      },
      {
        onRetry: ({ attempt, delayMs }) => {
          console.warn(
            `stt retry provider=${this.provider.name} attempt=${attempt} delay=${Math.round(delayMs)}ms`,
          )
        },
      },
    )

    return { text: readTranscript(response), label: this.label }
  }
}

/**
 * Read the transcription text.
 *
 * Providers answer with an object, a bare string, or a JSON string depending
 * on the model and the response format, so all three are handled.
 */
export function readTranscript(response: unknown): string {
  if (typeof response === 'string') {
    try {
      const parsed = JSON.parse(response) as { text?: unknown }
      if (typeof parsed?.text === 'string') {
        return parsed.text.trim()
      }
    } catch {
      // Not JSON: the string is the transcript.
    }
    return response.trim()
  }

  const text = (response as { text?: unknown })?.text
  return typeof text === 'string' ? text.trim() : ''
}

/**
 * A believable transcript for the mock provider.
 *
 * Varying with the length of the recording keeps the rest of the pipeline
 * honest: a silent tap produces the short phrase, a real hold produces the
 * longer one.
 */
function mockTranscript(audio: ArrayBuffer): string {
  const configured = process.env.CAP_STT_MOCK_TEXT
  if (configured && configured.trim() !== '') {
    return configured.trim()
  }
  // 16 kHz, 16-bit mono: two bytes per sample.
  const seconds = audio.byteLength / (16_000 * 2)
  return seconds < 1.5
    ? 'Bonjour Cap'
    : 'Rappelle-moi d’acheter du pain demain matin'
}
