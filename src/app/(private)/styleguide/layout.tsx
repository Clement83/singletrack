import { ClientMessages } from '@/i18n/client-messages';

// Messages sent to the browser for this segment (#1405): the styleguide shows every component.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages zone="all">{children}</ClientMessages>;
}
