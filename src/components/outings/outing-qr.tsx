'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { QrCode, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { qrSvg, qrUrl } from '@/lib/outings/qr';

/**
 * "QR code" button + native dialog (#1735): scan it with the companion app (or any phone camera) to open the outing.
 * The QR is generated in the browser from the page link; `personal` adds the warning for a guest's own link.
 */
export function OutingQr({ path, title, personal = false }: { path: string; title: string; personal?: boolean }) {
  const t = useTranslations('share.qr');
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!open) return;
    const full = qrUrl(window.location.origin, path);
    let cancelled = false;
    qrSvg(full)
      .then((s) => { if (!cancelled) { setUrl(full); setSvg(s); } })
      .catch(() => { if (!cancelled) setUrl(full); });
    return () => { cancelled = true; };
  }, [open, path]);

  const show = () => { setOpen(true); ref.current?.showModal(); };

  return (
    <>
      <Button variant="outline" onClick={show}>
        <QrCode aria-hidden /> {t('button')}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby="outing-qr-title"
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
        className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-border bg-card p-0 text-foreground shadow-lg backdrop:bg-scrim"
      >
        <div className="flex flex-col items-center gap-3 p-4">
          <div className="flex w-full items-start justify-between gap-2">
            <h2 id="outing-qr-title" className="text-heading text-pretty">{title}</h2>
            <Button variant="ghost" size="icon" className="shrink-0" aria-label={t('close')} onClick={() => ref.current?.close()}>
              <X aria-hidden />
            </Button>
          </div>
          {svg ? (
            <div
              role="img"
              aria-label={t('alt')}
              data-testid="outing-qr"
              className="size-64 max-w-full overflow-hidden rounded-md [&>svg]:size-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="size-64 max-w-full rounded-md bg-muted" aria-hidden />
          )}
          <p className="text-small text-muted-foreground text-pretty text-center">{t('scan')}</p>
          {personal && <p className="text-small font-medium text-destructive text-pretty text-center">{t('personal')}</p>}
          <p className="w-full break-all rounded-md bg-muted p-2 text-small select-all">{url}</p>
        </div>
      </dialog>
    </>
  );
}
