import { create } from 'zustand';
import type { Locale } from '@codeo/i18n';

export type Screen = 'home' | 'tickets' | 'tasks' | 'sessions' | 'review' | 'workspaces' | 'plugins' | 'settings';
export type ThemePref = 'dark' | 'light' | 'system';

interface UiState {
  screen: Screen;
  selectedSessionId: string | null;
  /** Task shown by the Review screen; null picks the first task in review. */
  reviewTaskId: string | null;
  workspaceId: string | null;
  locale: Locale;
  theme: ThemePref;
  calm: boolean;
  userName: string;
  navigate: (screen: Screen) => void;
  openSession: (id: string) => void;
  openReview: (taskId: string | null) => void;
  setWorkspace: (id: string | null) => void;
  setLocale: (l: Locale) => void;
  setTheme: (t: ThemePref) => void;
  setCalm: (c: boolean) => void;
  setUserName: (n: string) => void;
}

/** Transient UI state only; domain state lives in TanStack Query caches fed by the runtime. */
export const useUi = create<UiState>((set) => ({
  screen: 'home',
  selectedSessionId: null,
  reviewTaskId: null,
  workspaceId: null,
  locale: 'fr',
  theme: 'dark',
  calm: false,
  userName: '',
  navigate: (screen) => set({ screen }),
  openSession: (id) => set({ screen: 'sessions', selectedSessionId: id }),
  openReview: (reviewTaskId) => set({ screen: 'review', reviewTaskId }),
  setWorkspace: (workspaceId) => set({ workspaceId }),
  setLocale: (locale) => set({ locale }),
  setTheme: (theme) => set({ theme }),
  setCalm: (calm) => set({ calm }),
  setUserName: (userName) => set({ userName }),
}));
