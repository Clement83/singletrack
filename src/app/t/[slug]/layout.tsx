import { ClientMessages } from '@/i18n/client-messages';

// Messages envoyés au navigateur pour ce segment (#1405) : fiche trace (carte, profil, légende).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages zone="track">{children}</ClientMessages>;
}
