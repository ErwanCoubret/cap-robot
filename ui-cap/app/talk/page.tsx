import { VoiceScreen } from '../../presentation/components/VoiceScreen'

export default function Page() {
  return (
    <VoiceScreen
      mode="command"
      title="Parler à Cap"
      idleHint="Pose une question ou demande une action."
      startLabel="Parler"
    />
  )
}
