import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ProviderStatus } from '@codeo/domain';
import { Banner, Button, Card, Choice, PageHeader, Placeholder, StatusPill } from '@codeo/ui-desktop';
import type { RuntimeStatus } from '../../../shared/bridge-types';
import { codeo, invoke } from '../lib/api';
import { useT } from '../lib/i18n';
import { keys, useProviders } from '../lib/queries';
import { useUi } from '../lib/store';

function ProviderCard({ p }: { p: ProviderStatus }) {
  const t = useT();
  const caps = Object.entries(p.capabilities).filter(([, v]) => v).map(([k]) => k);
  return (
    <Card compact>
      <div className="cd-provider">
        <span className="cd-provider__mark">{p.displayName.charAt(0)}</span>
        <div style={{ minWidth: 0 }}>
          <div className="cd-card__title">{p.displayName}</div>
          <div className="cd-row-gap" style={{ marginTop: 6 }}>
            <StatusPill key={`${p.installed}`} tone={p.installed ? 'live' : 'error'}>
              {p.installed ? t('settings.provider.installed') : t('settings.provider.notInstalled')}
            </StatusPill>
            {p.installed ? (
              <StatusPill key={p.authenticated} tone={p.authenticated === 'yes' ? 'done' : p.authenticated === 'no' ? 'attention' : 'waiting'}>
                {t(`settings.provider.auth.${p.authenticated}`)}
              </StatusPill>
            ) : null}
          </div>
          <dl>
            {p.version ? (
              <>
                <dt>version</dt>
                <dd>{p.version}</dd>
              </>
            ) : null}
            {p.executable ? (
              <>
                <dt>exécutable</dt>
                <dd>{p.executable}</dd>
              </>
            ) : null}
            {p.authDetail ? (
              <>
                <dt>auth</dt>
                <dd>{p.authDetail}</dd>
              </>
            ) : null}
            <dt>{t('settings.provider.models')}</dt>
            <dd>{p.models.map((m) => m.id).join(', ') || '—'}</dd>
            <dt>{t('settings.provider.capabilities')}</dt>
            <dd>{caps.join(', ')}</dd>
          </dl>
          {p.error ? (
            <div style={{ marginTop: 8 }}>
              <Banner tone="error">{p.error}</Banner>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export function SettingsScreen() {
  const t = useT();
  const qc = useQueryClient();
  const providers = useProviders();
  const { theme, setTheme, calm, setCalm, locale, setLocale } = useUi();
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    void codeo.getRuntimeStatus().then(setRuntime);
    return codeo.onRuntimeStatus(setRuntime);
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    try {
      const list = await invoke('providers.list', { refresh: true });
      qc.setQueryData(keys.providers, list);
    } finally {
      setRefreshing(false);
    }
  };
  const pref = (key: string, value: unknown) => void codeo.setPreference(key, value);
  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="cd-stack" style={{ gap: 24 }}>
        <Card title={t('settings.providers')} icon="cpu" action={{ label: refreshing ? '…' : t('action.refresh'), onClick: () => void refresh() }}>
          <p className="cd-body-sm cd-muted" style={{ margin: '0 0 12px' }}>
            {t('settings.providers.hint')}
          </p>
          <div className="cd-grid cd-grid--2">{(providers.data ?? []).map((p) => <ProviderCard key={p.provider} p={p} />)}</div>
        </Card>
        <div className="cd-grid cd-grid--2">
          <Card title={t('settings.appearance')} icon="settings">
            <div className="cd-stack">
              <div>
                <div className="cd-field__label" style={{ marginBottom: 6 }}>{t('settings.appearance.theme')}</div>
                <div className="cd-row-gap">
                  {(['dark', 'light', 'system'] as const).map((th) => (
                    <Choice key={th} name="theme" checked={theme === th} onChange={() => { setTheme(th); pref('theme', th); }} label={th === 'dark' ? t('settings.appearance.dark') : th === 'light' ? t('settings.appearance.light') : 'Système'} />
                  ))}
                </div>
              </div>
              <Choice type="checkbox" checked={calm} onChange={() => { setCalm(!calm); pref('calm', !calm); }} label={t('settings.appearance.calm')} />
              <div>
                <div className="cd-field__label" style={{ marginBottom: 6 }}>{t('settings.language')}</div>
                <div className="cd-row-gap">
                  <Choice name="locale" checked={locale === 'fr'} onChange={() => { setLocale('fr'); pref('locale', 'fr'); }} label="Français" />
                  <Choice name="locale" checked={locale === 'en'} onChange={() => { setLocale('en'); pref('locale', 'en'); }} label="English" />
                </div>
              </div>
            </div>
          </Card>
          <Card title={t('settings.runtime')} icon="terminal">
            <dl className="cd-provider" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: 0 }}>
              <dt className="cd-muted cd-body-sm">{t('settings.runtime.version')}</dt>
              <dd className="cd-key" style={{ margin: 0 }}>{runtime?.info?.version ?? '—'}</dd>
              <dt className="cd-muted cd-body-sm">{t('settings.runtime.machine')}</dt>
              <dd className="cd-key" style={{ margin: 0 }}>{runtime?.info ? `${runtime.info.machine.name} · ${runtime.info.machine.platform}` : '—'}</dd>
              <dt className="cd-muted cd-body-sm">{t('settings.runtime.dataDir')}</dt>
              <dd className="cd-key" style={{ margin: 0, wordBreak: 'break-all' }}>{runtime?.info?.dataDir ?? '—'}</dd>
              <dt className="cd-muted cd-body-sm">état</dt>
              <dd style={{ margin: 0 }}>
                <StatusPill key={runtime?.state} tone={runtime?.state === 'connected' ? 'live' : runtime?.state === 'failed' ? 'error' : 'waiting'}>
                  {runtime?.state ?? '—'}
                </StatusPill>
              </dd>
            </dl>
            <div className="cd-divider" />
            <div className="cd-card__title" style={{ marginBottom: 8 }}>{t('settings.remote')}</div>
            <div className="cd-row-gap">
              <span className="cd-body-sm cd-muted">{t('settings.remote.placeholder')}</span>
              <Placeholder>{t('placeholder.phase', { n: 6 })}</Placeholder>
            </div>
            <div className="cd-divider" />
            <div className="cd-card__title" style={{ marginBottom: 8 }}>{t('settings.demo')}</div>
            <div className="cd-row-gap">
              <span className="cd-body-sm cd-muted">{t('settings.demo.hint')}</span>
              <Placeholder>{t('placeholder.phase', { n: 3 })}</Placeholder>
            </div>
            <div style={{ marginTop: 12 }}>
              <Button variant="ghost" size="sm" icon="external" onClick={() => void codeo.openExternal('https://code.claude.com/docs/en/agent-sdk/typescript')}>
                Agent SDK docs
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
