import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import type { PairedDevice, RemotePairing, RemoteStatus } from '@codeo/contracts';
import { Banner, Button, Field, Input, StatusPill, type Tone } from '@codeo/ui-desktop';
import { describeError, invoke } from '../lib/api';
import { useT } from '../lib/i18n';
import { keys, useRemoteDevices, useRemoteStatus } from '../lib/queries';
import { useUi } from '../lib/store';

const CONNECTION_TONE: Record<RemoteStatus['connection'], Tone> = {
  disabled: 'idle',
  connecting: 'waiting',
  connected: 'live',
  offline: 'attention',
  unauthorized: 'error',
};

/** Dark modules on a light plate in both themes: phone scanners read inverted codes unreliably. */
function QrCode({ payload, label }: { payload: string; label: string }) {
  const { theme } = useUi();
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const { size, path } = useMemo(() => {
    const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) d += `M${x} ${y}h1v1h-1z`;
    return { size: n, path: d };
  }, [payload]);
  const quiet = 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}`}
      width={208}
      height={208}
      shapeRendering="crispEdges"
      style={{ background: dark ? 'var(--ink)' : 'var(--bg-000)', borderRadius: 'var(--radius-md)', flex: 'none' }}
    >
      <path d={path} fill={dark ? 'var(--bg-000)' : 'var(--ink)'} />
    </svg>
  );
}

function useCountdown(until: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.round((Date.parse(until) - now) / 1000)) : 0;
}

function PairingPanel({ pairing, onDone }: { pairing: RemotePairing; onDone: () => void }) {
  const t = useT();
  const left = useCountdown(pairing.expiresAt);
  const expired = left === 0;
  return (
    <div className="cd-row-gap" style={{ alignItems: 'flex-start', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
      <QrCode payload={pairing.qrPayload} label={t('remote.pairing.qrLabel')} />
      <div className="cd-stack" style={{ minWidth: 0, flex: 1 }}>
        <div className="cd-body-sm cd-muted">{t('remote.pairing.scan')}</div>
        <div>
          <div className="cd-field__label">{t('remote.pairing.code')}</div>
          <div className="cd-key" style={{ fontSize: 'var(--text-title)', letterSpacing: 'var(--tracking-display)' }} aria-live="polite">
            {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
          </div>
        </div>
        <div>
          <div className="cd-field__label">{t('remote.fingerprint')}</div>
          <div className="cd-key cd-body-sm">{pairing.fingerprint}</div>
          <div className="cd-body-sm cd-faint">{t('remote.pairing.fingerprintHint')}</div>
        </div>
        {expired ? (
          <Banner tone="warn">{t('remote.pairing.expired')}</Banner>
        ) : (
          <div className="cd-body-sm cd-faint">{t('remote.pairing.expires', { seconds: left })}</div>
        )}
        <div>
          <Button variant="ghost" size="sm" icon="x" onClick={onDone}>
            {t('remote.pairing.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeviceRow({ device, onRevoke, busy }: { device: PairedDevice; onRevoke: () => void; busy: boolean }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="cd-row-gap" style={{ justifyContent: 'space-between', padding: 'var(--space-2) 0', borderTop: '1px solid var(--line)' }}>
      <div style={{ minWidth: 0 }}>
        <div className="cd-row-gap">
          <span className="cd-card__title">{device.name}</span>
          <span className="cd-body-sm cd-faint">{device.platform === 'ios' ? 'iOS' : 'Android'}</span>
          {device.revoked ? (
            <StatusPill key="revoked" tone="error">{t('remote.device.revoked')}</StatusPill>
          ) : (
            <StatusPill key={String(device.connected)} tone={device.connected ? 'live' : 'idle'}>
              {device.connected ? t('remote.device.online') : t('remote.device.offline')}
            </StatusPill>
          )}
        </div>
        <div className="cd-body-sm cd-faint">
          {t('remote.device.paired', { date: new Date(device.pairedAt).toLocaleString() })}
          {device.lastSeenAt ? ` · ${t('remote.device.lastSeen', { date: new Date(device.lastSeenAt).toLocaleString() })}` : ''}
        </div>
      </div>
      {device.revoked ? null : confirm ? (
        <div className="cd-row-gap">
          <Button variant="secondary" size="sm" icon="alert" loading={busy} onClick={onRevoke}>
            {t('remote.device.revokeConfirm')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
            {t('action.cancel')}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>
          {t('remote.device.revoke')}
        </Button>
      )}
    </li>
  );
}

/** Settings → Remote access: the runtime dials out to a Codeo gateway; phones pair with the QR code shown here. */
export function RemoteAccess() {
  const t = useT();
  const qc = useQueryClient();
  const status = useRemoteStatus();
  const s = status.data;
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<RemotePairing | null>(null);
  const devices = useRemoteDevices(Boolean(s?.enabled), pairing !== null);
  const knownDevices = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (s?.gatewayUrl && !url) setUrl(s.gatewayUrl);
  }, [s?.gatewayUrl, url]);

  /* A phone that completes the pairing shows up in the device list: the QR code has done its job. */
  useEffect(() => {
    const ids = new Set((devices.data ?? []).map((d) => d.deviceId));
    if (pairing && knownDevices.current && [...ids].some((id) => !knownDevices.current!.has(id))) setPairing(null);
    knownDevices.current = ids;
  }, [devices.data, pairing]);

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(describeError(err, t));
      return undefined;
    } finally {
      setBusy(null);
    }
  };
  const setStatus = (next: RemoteStatus | undefined) => {
    if (next) qc.setQueryData(keys.remote, next);
  };

  const connection = s?.connection ?? 'disabled';
  const canPair = Boolean(s?.enabled) && connection === 'connected';

  return (
    <div className="cd-stack">
      <p className="cd-body-sm cd-muted" style={{ margin: 0 }}>
        {t('remote.hint')}
      </p>
      <div className="cd-row-gap">
        <StatusPill key={connection} tone={CONNECTION_TONE[connection]}>
          {t(`remote.connection.${connection}`)}
        </StatusPill>
        {s?.runtimeId ? <span className="cd-body-sm cd-faint cd-key">{s.runtimeId}</span> : null}
      </div>
      {s?.fingerprint ? (
        <div className="cd-body-sm cd-muted">
          {t('remote.fingerprint')} <span className="cd-key">{s.fingerprint}</span>
        </div>
      ) : null}
      {s?.lastError && connection !== 'connected' ? <Banner tone={connection === 'unauthorized' ? 'error' : 'warn'}>{s.lastError}</Banner> : null}

      <form
        className="cd-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run('enable', () => invoke('remote.enable', { gatewayUrl: url.trim() })).then(setStatus);
        }}
      >
        <Field label={t('remote.gateway')} hint={t('remote.gateway.hint')} htmlFor="remote-gateway">
          <Input id="remote-gateway" mono type="url" required placeholder="https://gateway.codeo.dev" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="cd-row-gap">
          <Button type="submit" variant={s?.enabled ? 'secondary' : 'primary'} icon="shield" loading={busy === 'enable'} disabled={!url.trim() || busy !== null}>
            {s?.enabled ? t('remote.reconnect') : t('remote.enable')}
          </Button>
          {s?.enabled ? (
            <Button
              variant="ghost"
              icon="stop"
              loading={busy === 'disable'}
              disabled={busy !== null}
              onClick={() => {
                setPairing(null);
                void run('disable', () => invoke('remote.disable', {})).then(setStatus);
              }}
            >
              {t('remote.disable')}
            </Button>
          ) : null}
        </div>
      </form>
      {error ? <Banner tone="error">{error}</Banner> : null}

      {s?.enabled ? (
        <>
          <div className="cd-divider" />
          <div className="cd-row-gap" style={{ justifyContent: 'space-between' }}>
            <div className="cd-card__title">{t('remote.devices')}</div>
            {pairing ? null : (
              <Button
                variant="primary"
                size="sm"
                icon="plus"
                loading={busy === 'pair'}
                disabled={!canPair || busy !== null}
                onClick={() => void run('pair', () => invoke('remote.pairingStart', {})).then((p) => p && setPairing(p))}
              >
                {t('remote.pair')}
              </Button>
            )}
          </div>
          {!canPair && !pairing ? <div className="cd-body-sm cd-faint">{t('remote.pair.needsConnection')}</div> : null}
          {pairing ? <PairingPanel pairing={pairing} onDone={() => setPairing(null)} /> : null}
          {devices.error ? <Banner tone="warn">{describeError(devices.error, t)}</Banner> : null}
          {devices.data && devices.data.length === 0 ? <div className="cd-body-sm cd-muted">{t('remote.devices.empty')}</div> : null}
          {devices.data?.length ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {devices.data.map((d) => (
                <DeviceRow
                  key={d.deviceId}
                  device={d}
                  busy={busy === `revoke:${d.deviceId}`}
                  onRevoke={() =>
                    void run(`revoke:${d.deviceId}`, () => invoke('remote.revokeDevice', { deviceId: d.deviceId })).then(() => qc.invalidateQueries({ queryKey: keys.remoteDevices }))
                  }
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
