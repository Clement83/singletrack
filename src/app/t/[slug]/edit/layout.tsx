import { ClientMessages } from '@/i18n/client-messages';

// Messages envoyés au navigateur pour ce segment (#1405) : éditeur de traces.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages zone="editor">{children}</ClientMessages>;
}
