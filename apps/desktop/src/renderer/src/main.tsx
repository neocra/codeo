import '@codeo/ui-desktop/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useUi, type Screen } from './lib/store';

/* Navigation hook for the design-validation screenshot harness (see main/screenshots.ts). */
(window as unknown as { __codeoNavigate: (s: Screen) => void }).__codeoNavigate = (s) => useUi.getState().navigate(s);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
