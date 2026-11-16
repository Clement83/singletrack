import { ClientMessages } from '@/i18n/client-messages';

// Messages envoyés au navigateur pour ce segment (#1405) : sortie : organisateur, modification, lien de groupe.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages zone="outing">{children}</ClientMessages>;
}
