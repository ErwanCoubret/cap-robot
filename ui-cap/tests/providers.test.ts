import { afterEach, describe, expect, it } from 'vitest'

import {
  UnknownProviderError,
  describeProvider,
  isUsable,
  resolveLlmProvider,
  resolveSttProvider,
} from '../infrastructure/ai/providers'

const ORIGINAL = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe('resolveLlmProvider', () => {
  it('defaults to the local Ollama box with the configured model', () => {
    const provider = resolveLlmProvider('ollama')

    expect(provider.baseUrl).toBe('http://LLM:11434/v1')
    expect(provider.model).toBe('mistral-small3.2:24b')
    expect(provider.local).toBe(true)
    // Nothing to leak: the local endpoint needs no credential.
    expect(provider.credentialVariable).toBeNull()
    expect(isUsable(provider)).toBe(true)
  })

  it('honours the environment overrides', () => {
    process.env.OLLAMA_BASE_URL = 'http://192.168.1.9:11434/v1'
    process.env.CAP_LLM_MODEL = 'mistral-small3.2:24b-q4'

    const provider = resolveLlmProvider('ollama')

    expect(provider.baseUrl).toBe('http://192.168.1.9:11434/v1')
    expect(provider.model).toBe('mistral-small3.2:24b-q4')
  })

  it('accepts the spellings a human might type', () => {
    expect(resolveLlmProvider('SCW').name).toBe('scaleway')
    expect(resolveLlmProvider('Scaleway').name).toBe('scaleway')
  })

  it('rejects an unknown provider instead of falling back', () => {
    // Falling back would send the user's conversation to a vendor nobody
    // chose; failing loudly at boot is the whole point.
    expect(() => resolveLlmProvider('gpt-5-turbo')).toThrow(UnknownProviderError)
  })

  it('reports a hosted provider as unusable without its key', () => {
    delete process.env.SCW_SECRET_KEY

    const provider = resolveLlmProvider('scaleway')

    expect(isUsable(provider)).toBe(false)
    expect(describeProvider(provider)).toContain('MISSING=SCW_SECRET_KEY')
  })

  it('becomes usable once the key is present', () => {
    process.env.SCW_SECRET_KEY = 'scw-secret'

    expect(isUsable(resolveLlmProvider('scaleway'))).toBe(true)
  })
})

describe('resolveSttProvider', () => {
  it('defaults to the simulated transcriber', () => {
    // With nothing configured the robot must not pick a vendor by itself.
    const provider = resolveSttProvider()

    expect(provider.name).toBe('mock')
    expect(provider.local).toBe(true)
  })

  it('describes OVHcloud with the whisper turbo model', () => {
    process.env.OVH_AI_ENDPOINTS_ACCESS_TOKEN = 'ovh-token'

    const provider = resolveSttProvider('ovhcloud')

    expect(provider.name).toBe('ovh')
    expect(provider.model).toBe('whisper-large-v3-turbo')
    expect(provider.baseUrl).toContain('kepler.ai.cloud.ovh.net')
    expect(isUsable(provider)).toBe(true)
  })

  it('points the local transcriber at the robot network by default', () => {
    const provider = resolveSttProvider('local')

    expect(provider.local).toBe(true)
    expect(provider.baseUrl).toBe('http://LLM:11434/v1')
    expect(provider.credentialVariable).toBeNull()
  })

  it('lists the known names when the configured one is wrong', () => {
    expect(() => resolveSttProvider('deepgram')).toThrow(
      'valeurs possibles : local, ovh, scaleway, mock',
    )
  })
})

describe('describeProvider', () => {
  it('summarises a provider on one line', () => {
    const line = describeProvider(resolveLlmProvider('ollama'))

    expect(line).toContain('llm=ollama')
    expect(line).toContain('model=mistral-small3.2:24b')
    expect(line).toContain('local=yes')
    expect(line).not.toContain('MISSING')
  })
})
