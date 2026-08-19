import { VoiceScreen } from '../../presentation/components/VoiceScreen'

export default function Page() {
  return (
    <VoiceScreen
      mode="note"
      title="Note vocale"
      idleHint="Dicte ta note, Cap l’enregistre dans Flots."
      startLabel="Dicter"
    />
  )
}
