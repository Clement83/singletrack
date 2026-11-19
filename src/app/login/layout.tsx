import { ClientMessages } from '@/i18n/client-messages';

// Messages sent to the browser for this segment (#1405): sign-in.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientMessages zone="auth">{children}</ClientMessages>;
}
