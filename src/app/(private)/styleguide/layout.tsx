import { ClientMessages } from '@/i18n/client-messages';

// Messages envoyés au navigateur pour ce segment (#1405) : le styleguide montre tous les composants.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages zone="all">{children}</ClientMessages>;
}
