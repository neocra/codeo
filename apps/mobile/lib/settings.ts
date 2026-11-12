import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { DEFAULT_LOCALE, type Locale } from '@codeo/i18n';
import { GatewayCredentialsSchema, type GatewayCredentials } from '@codeo/remote-client';

/** SecureStore keys (alphanumeric, '.', '-', '_' only). */
const KEYS = {
  url: 'codeo.runtime.url',
  token: 'codeo.runtime.token',
  locale: 'codeo.locale',
  name: 'codeo.profile.name',
  gateway: 'codeo.gateway.credentials',
} as const;

/* Gateway credentials hold the refresh token: never synced to iCloud / backups, readable only while unlocked. */
const SECRET_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

function parseGateway(raw: string | null): GatewayCredentials | null {
  if (!raw) return null;
  try {
    const parsed = GatewayCredentialsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function read(key: string, options?: SecureStore.SecureStoreOptions): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, options);
  } catch {
    return null;
  }
}

async function write(key: string, value: string, options?: SecureStore.SecureStoreOptions): Promise<void> {
  try {
    if (value.length === 0) await SecureStore.deleteItemAsync(key, options);
    else await SecureStore.setItemAsync(key, value, options);
  } catch (err) {
    console.warn(`[settings] could not persist ${key}`, err);
  }
}

function isLocale(value: string | null): value is Locale {
  return value === 'fr' || value === 'en';
}

export interface SettingsState {
  /** True once SecureStore has been read on launch. */
  hydrated: boolean;
  /** Runtime WebSocket URL, e.g. `ws://127.0.0.1:52133`. */
  url: string;
  /** Runtime bearer token (from `~/.codeo/runtime.json`). */
  token: string;
  locale: Locale;
  /** First name shown in the greeting; purely local. */
  name: string;
  /** Set once this phone is paired with a runtime through a gateway; takes precedence over `url`/`token`. */
  gateway: GatewayCredentials | null;
  hydrate: () => Promise<void>;
  setConnection: (url: string, token: string) => Promise<void>;
  clearConnection: () => Promise<void>;
  setLocale: (locale: Locale) => Promise<void>;
  setName: (name: string) => Promise<void>;
  /** Stores paired (or rotated) gateway credentials in the keychain. */
  setGateway: (credentials: GatewayCredentials) => Promise<void>;
  /** Forgets the pairing on this phone (the desktop still lists the device until it is revoked there). */
  clearGateway: () => Promise<void>;
}

export const useSettings = create<SettingsState>()((set) => ({
  hydrated: false,
  url: '',
  token: '',
  locale: DEFAULT_LOCALE,
  name: '',
  gateway: null,

  hydrate: async () => {
    const [url, token, locale, name, gateway] = await Promise.all([
      read(KEYS.url),
      read(KEYS.token),
      read(KEYS.locale),
      read(KEYS.name),
      read(KEYS.gateway, SECRET_OPTIONS),
    ]);
    set({
      hydrated: true,
      gateway: parseGateway(gateway),
      url: url ?? '',
      token: token ?? '',
      locale: isLocale(locale) ? locale : DEFAULT_LOCALE,
      name: name ?? '',
    });
  },

  setConnection: async (url, token) => {
    const cleanUrl = url.trim();
    const cleanToken = token.trim();
    set({ url: cleanUrl, token: cleanToken });
    await Promise.all([write(KEYS.url, cleanUrl), write(KEYS.token, cleanToken)]);
  },

  clearConnection: async () => {
    set({ url: '', token: '' });
    await Promise.all([write(KEYS.url, ''), write(KEYS.token, '')]);
  },

  setLocale: async (locale) => {
    set({ locale });
    await write(KEYS.locale, locale);
  },

  setName: async (name) => {
    const clean = name.trim();
    set({ name: clean });
    await write(KEYS.name, clean);
  },

  setGateway: async (credentials) => {
    set({ gateway: credentials });
    await write(KEYS.gateway, JSON.stringify(credentials), SECRET_OPTIONS);
  },

  clearGateway: async () => {
    set({ gateway: null });
    await write(KEYS.gateway, '', SECRET_OPTIONS);
  },
}));

/** True when this phone is paired through a gateway, or both the direct URL and the token are present. */
export const selectConfigured = (s: SettingsState): boolean => s.gateway !== null || (s.url.length > 0 && s.token.length > 0);
