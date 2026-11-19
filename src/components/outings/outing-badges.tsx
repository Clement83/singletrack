import { Bike, Eye, Gauge } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { OutingRow } from '@/db/schema';

/** Required level and e-bike: always both, as badges. */
export function OutingBadges({ level, ebike, cancelled, done, visibility }: { level: OutingRow['level']; ebike: OutingRow['ebike']; cancelled?: boolean; done?: boolean; visibility?: OutingRow['visibility'] }) {
  const t = useTranslations('outingLabels');
  const tv = useTranslations('outingVisibility');
  return (
    <div className="flex flex-wrap gap-2">
      {done && !cancelled && <Badge variant="success">{t('status.done')}</Badge>}
      {cancelled && <Badge variant="danger">{t('status.cancelled')}</Badge>}
      <Badge variant="primary"><Gauge aria-hidden /> {t(`level.${level}`)}</Badge>
      <Badge variant="outline"><Bike aria-hidden /> {t(`ebike.${ebike}`)}</Badge>
      {visibility && visibility !== 'invite' && <Badge variant="outline"><Eye aria-hidden /> {tv(`badge.${visibility}`)}</Badge>}
    </div>
  );
}
