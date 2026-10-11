import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { Locale } from '@codeo/i18n';
import { Button, Card, Divider, FilterPills, Section, StatusPill, Typo, useTheme } from '@codeo/ui-mobile';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import { connectionStateLabel, connectionTone } from '@/lib/presentation';
import { useCommand, useRuntime } from '@/lib/runtime';
import { useSettings } from '@/lib/settings';

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing['space-3'], paddingVertical: theme.spacing['space-2'] }}>
      <Typo variant="body-sm" color="ink-muted">
        {label}
      </Typo>
      <Typo variant={mono ? 'code-sm' : 'body-sm'} numberOfLines={1} style={{ flexShrink: 1 }}>
        {value}
      </Typo>
    </View>
  );
}

/** Réglages: runtime connection, runtime info, profile, language, and the remote-access placeholder. */
export default function MoreScreen() {
  const t = useT();
  const { theme } = useTheme();
  const { state, error, configured } = useRuntime();
  const settings = useSettings();
  const [url, setUrl] = useState(settings.url);
  const [token, setToken] = useState(settings.token);
  const [name, setName] = useState(settings.name);
  const [saving, setSaving] = useState(false);
  const runtimeInfo = useCommand('runtime.info', {});

  useEffect(() => setUrl(settings.url), [settings.url]);
  useEffect(() => setToken(settings.token), [settings.token]);
  useEffect(() => setName(settings.name), [settings.name]);

  const dirty = url.trim() !== settings.url || token.trim() !== settings.token;

  const save = async () => {
    setSaving(true);
    try {
      await settings.setConnection(url, token);
    } finally {
      setSaving(false);
    }
  };

  const localeOptions = [
    { id: 'fr', label: t('settings.language.fr') },
    { id: 'en', label: t('settings.language.en') },
  ] as const satisfies readonly { id: Locale; label: string }[];

  return (
    <Screen title={t('settings.title')} subtitle={t('settings.subtitle')} trailing={<StatusPill tone={connectionTone(state)} label={connectionStateLabel(state, t)} />}>
      <Section kicker={t('settings.connection')}>
        <Card style={{ gap: theme.spacing['space-4'] }}>
          <Typo variant="body-sm" color="ink-muted">
            {t('settings.connection.hint')}
          </Typo>
          <Field label={t('settings.connection.url')} value={url} onChangeText={setUrl} placeholder="ws://127.0.0.1:52133" mono keyboardType="url" />
          <Field label={t('settings.connection.token')} value={token} onChangeText={setToken} mono secure />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing['space-2'] }}>
            <Typo variant="body-sm" color="ink-muted">
              {t('settings.connection.state')}
            </Typo>
            <StatusPill tone={connectionTone(state)} label={connectionStateLabel(state, t)} />
          </View>
          {error ? (
            <Typo variant="body-sm" color="coral">
              {error}
            </Typo>
          ) : null}
          <View style={{ flexDirection: 'row', gap: theme.spacing['space-2'] }}>
            <Button
              variant="primary"
              label={t('settings.connection.save')}
              onPress={() => void save()}
              loading={saving}
              disabled={!dirty || url.trim().length === 0 || token.trim().length === 0}
              style={{ flex: 1 }}
            />
            {configured ? <Button variant="ghost" label={t('settings.connection.forget')} onPress={() => void settings.clearConnection()} /> : null}
          </View>
        </Card>
      </Section>

      <Section kicker={t('settings.runtime')}>
        <Card compact>
          {runtimeInfo.data ? (
            <View>
              <Row label={t('settings.runtime.version')} value={runtimeInfo.data.version} />
              <Divider />
              <Row label={t('settings.runtime.machine')} value={`${runtimeInfo.data.machine.name} · ${runtimeInfo.data.machine.platform}`} />
              <Divider />
              <Row label={t('settings.runtime.dataDir')} value={runtimeInfo.data.dataDir} />
              {runtimeInfo.data.demoMode ? (
                <>
                  <Divider />
                  <Row label={t('settings.demo')} value={t('settings.demo.hint')} mono={false} />
                </>
              ) : null}
            </View>
          ) : (
            <Typo variant="body-sm" color="ink-muted">
              {state === 'connected' ? t('mobile.loading') : t('mobile.notConnected.title')}
            </Typo>
          )}
        </Card>
      </Section>

      <Section kicker={t('settings.profile')}>
        <Card compact>
          <Field label={t('settings.profile.name')} value={name} onChangeText={setName} autoCapitalize="words" onBlur={() => void settings.setName(name)} />
        </Card>
      </Section>

      <Section kicker={t('settings.language')}>
        <FilterPills options={localeOptions} value={settings.locale} onChange={(id) => void settings.setLocale(id)} />
      </Section>

      <Section kicker={t('settings.remote')}>
        <Card compact style={{ gap: theme.spacing['space-2'] }}>
          <StatusPill tone="idle" label={t('placeholder.phase', { n: 6 })} />
          <Typo variant="body-sm" color="ink-muted">
            {t('settings.remote.placeholder')}
          </Typo>
        </Card>
      </Section>
    </Screen>
  );
}
