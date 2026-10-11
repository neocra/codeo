import { TextInput, View, type TextInputProps } from 'react-native';
import { Typo, useTextStyle, useTheme } from '@codeo/ui-mobile';

export interface FieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Keys, URLs and tokens are mono. */
  mono?: boolean;
  secure?: boolean;
  multiline?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  keyboardType?: TextInputProps['keyboardType'];
  onBlur?: () => void;
}

/** Labelled input on `bg-300` with a `line-strong` outline. */
export function Field({ label, value, onChangeText, placeholder, mono = false, secure = false, multiline = false, autoCapitalize = 'none', keyboardType, onBlur }: FieldProps) {
  const { theme } = useTheme();
  const text = useTextStyle(mono ? 'code' : 'body');
  return (
    <View style={{ gap: theme.spacing['space-1'] }}>
      <Typo variant="label" color="ink-muted">
        {label}
      </Typo>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors['ink-faint']}
        secureTextEntry={secure}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        onBlur={onBlur}
        style={[
          text,
          {
            minHeight: multiline ? 80 : 40,
            paddingHorizontal: theme.spacing['space-3'],
            paddingVertical: multiline ? theme.spacing['space-2'] : 0,
            borderRadius: theme.radii['radius-sm'],
            borderWidth: 1,
            borderColor: theme.colors['line-strong'],
            backgroundColor: theme.colors['bg-300'],
            textAlignVertical: multiline ? 'top' : 'center',
          },
        ]}
      />
    </View>
  );
}
