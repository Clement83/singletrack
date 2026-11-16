import { ClientMessages } from '@/i18n/client-messages';

// Messages envoyés au navigateur pour ce segment (#1405) : page invité (réponse, partage, trace).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages zone="guest">{children}</ClientMessages>;
}
