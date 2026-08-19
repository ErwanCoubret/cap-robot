import { SettingsScreen } from '../../presentation/components/SettingsScreen'

export default async function Page({ searchParams }: PageProps<'/settings'>) {
  // Next 16 hands these over asynchronously.
  const params = await searchParams
  const error = params.pairing_error

  return (
    <SettingsScreen
      paired={params.paired === '1'}
      pairingError={Array.isArray(error) ? error[0] : error}
    />
  )
}
