import { ClientMessages } from '@/i18n/client-messages';

// Messages sent to the browser for this segment (#1405): guest page (answer, sharing, track).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages zone="guest">{children}</ClientMessages>;
}
