/**
 * Which model answers, and where it runs.
 *
 * Every provider speaks the OpenAI API, so one client shape serves the local
 * Ollama box and the hosted fallbacks alike. Choosing is explicit: an
 * unrecognised name is an error rather than a silent fallback, because
 * quietly sending a user's voice to a vendor nobody picked is not an
 * acceptable default.
 */

export type ProviderKind = 'llm' | 'stt'

export interface ProviderDescriptor {
  /** Canonical name, as written in the environment. */
  name: string
  /** Human-readable provider name for the interface. */
  label: string
  kind: ProviderKind
  model: string
  baseUrl: string
  /** Name of the environment variable holding the credential, if any. */
  credentialVariable: string | null
  credential: string | null
  /** True when the model runs on the robot's own network. */
  local: boolean
}

/** Raised when the configured provider name is not recognised. */
export class UnknownProviderError extends Error {
  constructor(kind: ProviderKind, name: string, known: string[]) {
    super(
      `fournisseur ${kind} inconnu : "${name}" (valeurs possibles : ${known.join(', ')})`,
    )
    this.name = 'UnknownProviderError'
  }
}

/** Tolerate the spellings a human might type into a configuration file. */
const ALIASES: Record<string, string> = {
  ollama: 'ollama',
  local: 'local',
  scaleway: 'scaleway',
  scw: 'scaleway',
  ovh: 'ovh',
  ovhcloud: 'ovh',
  'ovh-cloud': 'ovh',
  mock: 'mock',
  none: 'mock',
  fake: 'mock',
}

function env(name: string, fallback = ''): string {
  const value = process.env[name]
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback
}

function normalise(kind: ProviderKind, raw: string, known: string[]): string {
  const canonical = ALIASES[raw.toLowerCase()]
  if (!canonical || !known.includes(canonical)) {
    throw new UnknownProviderError(kind, raw, known)
  }
  return canonical
}

/** Whether the descriptor has everything it needs to be used. */
export function isUsable(provider: ProviderDescriptor): boolean {
  return provider.credentialVariable === null || Boolean(provider.credential)
}

function llmProviders(): Record<string, ProviderDescriptor> {
  return {
    ollama: {
      name: 'ollama',
      label: 'Ollama (local)',
      kind: 'llm',
      // The robot's own network: no credential, and nothing leaves the house.
      model: env('CAP_LLM_MODEL', 'mistral-small3.2:24b'),
      baseUrl: env('OLLAMA_BASE_URL', 'http://LLM:11434/v1'),
      credentialVariable: null,
      credential: null,
      local: true,
    },
    scaleway: {
      name: 'scaleway',
      label: 'Scaleway',
      kind: 'llm',
      model: env('SCW_LLM_MODEL', 'mistral/mistral-small-3.2-24b-instruct-2506:fp8'),
      baseUrl: env('SCW_BASE_URL', 'https://api.scaleway.ai/v1'),
      credentialVariable: 'SCW_SECRET_KEY',
      credential: env('SCW_SECRET_KEY') || null,
      local: false,
    },
  }
}

function sttProviders(): Record<string, ProviderDescriptor> {
  return {
    local: {
      name: 'local',
      label: 'Transcription locale',
      kind: 'stt',
      // A local speech model is coming; it only needs to speak the OpenAI API
      // for this entry to start working.
      model: env('CAP_STT_MODEL', 'whisper-large-v3'),
      baseUrl: env('CAP_STT_BASE_URL', 'http://LLM:11434/v1'),
      credentialVariable: null,
      credential: null,
      local: true,
    },
    ovh: {
      name: 'ovh',
      label: 'OVHcloud',
      kind: 'stt',
      model: env('OVH_TRANSCRIPTION_MODEL', 'whisper-large-v3-turbo'),
      baseUrl: env(
        'OVH_AI_ENDPOINTS_BASE_URL',
        'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
      ),
      credentialVariable: 'OVH_AI_ENDPOINTS_ACCESS_TOKEN',
      credential: env('OVH_AI_ENDPOINTS_ACCESS_TOKEN') || null,
      local: false,
    },
    scaleway: {
      name: 'scaleway',
      label: 'Scaleway',
      kind: 'stt',
      model: env('SCW_TRANSCRIPTION_MODEL', 'whisper-large-v3'),
      baseUrl: env('SCW_BASE_URL', 'https://api.scaleway.ai/v1'),
      credentialVariable: 'SCW_SECRET_KEY',
      credential: env('SCW_SECRET_KEY') || null,
      local: false,
    },
    mock: {
      name: 'mock',
      label: 'Transcription simulée',
      kind: 'stt',
      model: 'mock',
      baseUrl: '',
      credentialVariable: null,
      credential: null,
      local: true,
    },
  }
}

/** Resolve the configured language-model provider. */
export function resolveLlmProvider(
  raw = env('CAP_LLM_PROVIDER', 'ollama'),
): ProviderDescriptor {
  const known = llmProviders()
  return known[normalise('llm', raw, Object.keys(known))]
}

/**
 * Resolve the configured speech-to-text provider.
 *
 * With nothing configured the robot transcribes nothing rather than picking a
 * vendor on the user's behalf: the mock provider keeps the interface usable
 * and says plainly that transcription is simulated.
 */
export function resolveSttProvider(
  raw = env('CAP_STT_PROVIDER', 'mock'),
): ProviderDescriptor {
  const known = sttProviders()
  return known[normalise('stt', raw, Object.keys(known))]
}

/**
 * One-line summary of a provider, logged at boot.
 *
 * A missing credential is worth shouting about now rather than when the user
 * is standing in front of the robot waiting for an answer.
 */
export function describeProvider(provider: ProviderDescriptor): string {
  const parts = [
    `${provider.kind}=${provider.name}`,
    `model=${provider.model}`,
    provider.baseUrl ? `url=${provider.baseUrl}` : '',
    provider.local ? 'local=yes' : 'local=no',
  ].filter(Boolean)

  if (provider.credentialVariable && !provider.credential) {
    parts.push(`MISSING=${provider.credentialVariable}`)
  }
  return parts.join(' ')
}
