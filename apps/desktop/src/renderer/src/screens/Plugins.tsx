import { Banner, PageHeader, Placeholder } from '@codeo/ui-desktop';
import { useT } from '../lib/i18n';

export function PluginsScreen() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('plugins.title')} />
      <Banner tone="info">
        {t('plugins.placeholder')} <Placeholder>{t('placeholder.phase', { n: 8 })}</Placeholder>
      </Banner>
    </>
  );
}
