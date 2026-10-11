import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { DEFAULT_LOCALE, type Locale } from '@codeo/i18n';

/** SecureStore keys (alphanumeric, '.', '-', '_' only). */
const KEYS = {
  url: 'codeo.runtime.url',
  token: 'codeo.runtime.token',
  locale: 'codeo.locale',
  name: 'codeo.profile.name',
} as const;

async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function write(key: string, value: string): Promise<void> {
  try {
    if (value.length === 0) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
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
  hydrate: () => Promise<void>;
  setConnection: (url: string, token: string) => Promise<void>;
  clearConnection: () => Promise<void>;
  setLocale: (locale: Locale) => Promise<void>;
  setName: (name: string) => Promise<void>;
}

export const useSettings = create<SettingsState>()((set) => ({
  hydrated: false,
  url: '',
  token: '',
  locale: DEFAULT_LOCALE,
  name: '',

  hydrate: async () => {
    const [url, token, locale, name] = await Promise.all([read(KEYS.url), read(KEYS.token), read(KEYS.locale), read(KEYS.name)]);
    set({
      hydrated: true,
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
}));

/** True when both the URL and the token are present. */
export const selectConfigured = (s: SettingsState): boolean => s.url.length > 0 && s.token.length > 0;
