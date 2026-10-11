/**
 * The package is font-agnostic: it only references family *names*. The app registers
 * the matching font files (expo-font) under these names, or overrides the resolver
 * through `ThemeProvider`'s `fontFamily` prop.
 */
export type FontWeight = 400 | 500 | 600 | 700;
export type FontFamilyResolver = (weight: FontWeight, mono: boolean) => string;

export const FONT_NAMES = {
  sansRegular: 'Geist-Regular',
  sansMedium: 'Geist-Medium',
  sansSemiBold: 'Geist-SemiBold',
  sansBold: 'Geist-Bold',
  monoRegular: 'JetBrainsMono-Regular',
  monoMedium: 'JetBrainsMono-Medium',
} as const;

export const defaultFontFamily: FontFamilyResolver = (weight, mono) => {
  if (mono) return weight >= 500 ? FONT_NAMES.monoMedium : FONT_NAMES.monoRegular;
  switch (weight) {
    case 400:
      return FONT_NAMES.sansRegular;
    case 500:
      return FONT_NAMES.sansMedium;
    case 600:
      return FONT_NAMES.sansSemiBold;
    case 700:
      return FONT_NAMES.sansBold;
  }
};
