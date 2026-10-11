import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { theme } from '@codeo/ui-tokens';
import { FONT_NAMES, ThemeProvider } from '@codeo/ui-mobile';
import { RuntimeProvider } from '@/lib/runtime';
import { useSettings } from '@/lib/settings';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: false } },
});

const dark = theme('dark');

export default function RootLayout() {
  // ui-mobile only knows family *names*; the app registers the files under those names.
  const [fontsLoaded, fontsError] = useFonts({
    [FONT_NAMES.sansRegular]: Geist_400Regular,
    [FONT_NAMES.sansMedium]: Geist_500Medium,
    [FONT_NAMES.sansSemiBold]: Geist_600SemiBold,
    [FONT_NAMES.sansBold]: Geist_700Bold,
    [FONT_NAMES.monoRegular]: JetBrainsMono_400Regular,
    [FONT_NAMES.monoMedium]: JetBrainsMono_500Medium,
  });
  const hydrated = useSettings((s) => s.hydrated);
  const hydrate = useSettings((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (fontsError) console.warn('[fonts] falling back to system fonts', fontsError);
  }, [fontsError]);

  if ((!fontsLoaded && !fontsError) || !hydrated) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider themeId="dark">
        <RuntimeProvider>
          <StatusBar style="light" backgroundColor={dark.colors['bg-000']} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: dark.colors['bg-000'] } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="session/[id]" />
          </Stack>
        </RuntimeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
