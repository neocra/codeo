import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { GatewayClientError, completePairing, parsePairingQr, type CompletePairingInput } from '@codeo/remote-client';
import { Button, Card, Icon, Section, Typo, useTheme } from '@codeo/ui-mobile';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';

type Step = { kind: 'scan' } | { kind: 'pairing' } | { kind: 'error'; message: string };

function goBack() {
  if (router.canGoBack()) router.back();
  else router.navigate('/more');
}

function deviceInfo(): CompletePairingInput['device'] {
  const fallback = Platform.OS === 'ios' ? 'iPhone' : 'Android';
  return { name: (Constants.deviceName ?? fallback).slice(0, 120), platform: Platform.OS === 'ios' ? 'ios' : 'android' };
}

/**
 * Pairs this phone with a runtime through its gateway: scan the QR code the desktop shows (Settings →
 * Remote access → Pair a phone), or type the gateway address and the 6-digit code. The credentials go
 * straight to the keychain; the runtime connection switches to the gateway as soon as they are stored.
 */
export default function PairScreen() {
  const t = useT();
  const { theme } = useTheme();
  const setGateway = useSettings((s) => s.setGateway);
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState<Step>({ kind: 'scan' });
  const [manual, setManual] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState(useSettings.getState().gateway?.gatewayUrl ?? '');
  const [code, setCode] = useState('');
  /* The scanner fires many times per second; only the first read of a code counts. */
  const busy = useRef(false);

  const describe = (err: unknown): string =>
    err instanceof GatewayClientError ? t(`pair.error.${err.code}`) : err instanceof Error ? err.message : String(err);

  const pair = async (input: Omit<CompletePairingInput, 'device'>) => {
    setStep({ kind: 'pairing' });
    try {
      const credentials = await completePairing({ ...input, device: deviceInfo() });
      await setGateway(credentials);
      router.replace('/');
    } catch (err) {
      setStep({ kind: 'error', message: describe(err) });
    } finally {
      busy.current = false;
    }
  };

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (busy.current || step.kind !== 'scan') return;
    busy.current = true;
    try {
      const qr = parsePairingQr(data);
      void pair({ gatewayUrl: qr.gateway, code: qr.code, nonce: qr.nonce, runtimeId: qr.runtimeId, runtimeKey: qr.key });
    } catch (err) {
      busy.current = false;
      setStep({ kind: 'error', message: describe(err) });
    }
  };

  const back = (
    <Pressable onPress={goBack} accessibilityRole="button" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing['space-1'], alignSelf: 'flex-start' }}>
      <View style={{ transform: [{ scaleX: -1 }] }}>
        <Icon name="chevron" size={16} color="ink-muted" />
      </View>
      <Typo variant="label" color="ink-muted">
        {t('pair.back')}
      </Typo>
    </Pressable>
  );

  const cleanCode = code.replace(/\D/g, '');
  const scanning = step.kind === 'scan' && !manual;

  return (
    <Screen title={t('pair.title')} subtitle={t('pair.subtitle')} leading={back}>
      {!manual ? (
        <Section kicker={t('pair.scan')}>
          <Card style={{ gap: theme.spacing['space-4'] }}>
            {permission?.granted ? (
              <>
                <View
                  style={{
                    aspectRatio: 1,
                    borderRadius: theme.radii['radius-lg'],
                    overflow: 'hidden',
                    borderWidth: 1,
                    borderColor: theme.colors['line-strong'],
                    backgroundColor: theme.colors['bg-000'],
                  }}
                >
                  {scanning ? (
                    <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
                  ) : null}
                </View>
                <Typo variant="body-sm" color="ink-muted">
                  {t('pair.scan.hint')}
                </Typo>
              </>
            ) : permission && !permission.canAskAgain ? (
              <>
                <Typo variant="body-sm" color="ink-muted">
                  {t('pair.camera.denied')}
                </Typo>
                <Button variant="secondary" icon="settings" label={t('pair.camera.settings')} onPress={() => void Linking.openSettings()} />
              </>
            ) : (
              <>
                <Typo variant="body-sm" color="ink-muted">
                  {t('pair.camera.request')}
                </Typo>
                <Button variant="primary" label={t('pair.camera.allow')} onPress={() => void requestPermission()} />
              </>
            )}
          </Card>
        </Section>
      ) : (
        <Section kicker={t('pair.manual')}>
          <Card style={{ gap: theme.spacing['space-4'] }}>
            <Typo variant="body-sm" color="ink-muted">
              {t('pair.manual.hint')}
            </Typo>
            <Field label={t('pair.manual.gateway')} value={gatewayUrl} onChangeText={setGatewayUrl} placeholder="https://gateway.example.com" mono keyboardType="url" />
            <Field label={t('pair.manual.code')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder="000000" mono keyboardType="number-pad" />
            <Button
              variant="primary"
              label={step.kind === 'pairing' ? t('pair.pairing') : t('pair.submit')}
              loading={step.kind === 'pairing'}
              disabled={step.kind === 'pairing' || gatewayUrl.trim().length === 0 || cleanCode.length !== 6}
              onPress={() => void pair({ gatewayUrl, code: cleanCode })}
            />
          </Card>
        </Section>
      )}

      {step.kind === 'pairing' && !manual ? (
        <Typo variant="body-sm" color="ink-muted" align="center">
          {t('pair.pairing')}
        </Typo>
      ) : null}

      {step.kind === 'error' ? (
        <Card compact style={{ gap: theme.spacing['space-3'] }}>
          <Typo variant="body-sm" color="coral">
            {step.message}
          </Typo>
          {!manual ? <Button variant="secondary" label={t('pair.retry')} onPress={() => setStep({ kind: 'scan' })} /> : null}
        </Card>
      ) : null}

      <Button
        variant="ghost"
        label={manual ? t('pair.scan') : t('pair.manual')}
        onPress={() => {
          setManual(!manual);
          setStep({ kind: 'scan' });
        }}
      />
    </Screen>
  );
}
