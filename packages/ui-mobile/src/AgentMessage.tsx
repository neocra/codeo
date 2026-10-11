import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Avatar } from './Avatar';
import { useTheme } from './theme';
import { Typo } from './Typo';

export interface AgentMessageProps {
  initial: string;
  author: string;
  /** Relative, short: "il y a 1 h 24". */
  time: string;
  text: string;
  /** `user` messages sit on `bg-300`, agents on `bg-200`. */
  tone?: 'agent' | 'user';
  /** Shows a blinking caret at the end while the reply streams. */
  streaming?: boolean;
}

/** A chat bubble: avatar, author, time and the text. Arrives once, then holds still. */
export function AgentMessage({ initial, author, time, text, tone = 'agent', streaming = false }: AgentMessageProps) {
  const { theme, calm } = useTheme();
  const caret = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!streaming || calm) {
      caret.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(caret, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(caret, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [streaming, calm, caret]);

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing['space-3'], alignItems: 'flex-start' }}>
      <Avatar initial={initial} ground={tone === 'user' ? 'bg-400' : 'bg-300'} ring={tone === 'user' ? 'line' : 'line-strong'} />
      <View style={{ flex: 1, gap: theme.spacing['space-1'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing['space-2'] }}>
          <Typo variant="label" numberOfLines={1}>
            {author}
          </Typo>
          <Typo variant="code-sm" color="ink-faint" tabular>
            {time}
          </Typo>
        </View>
        <View
          style={{
            backgroundColor: tone === 'user' ? theme.colors['bg-300'] : theme.colors['bg-200'],
            borderWidth: 1,
            borderColor: theme.colors.line,
            borderRadius: theme.radii['radius-md'],
            borderTopLeftRadius: theme.radii['radius-xs'],
            padding: theme.spacing['space-3'],
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
          }}
        >
          <Typo variant="body" style={{ flexShrink: 1 }}>
            {text}
          </Typo>
          {streaming ? (
            <Animated.View
              style={{ width: 2, height: 16, marginLeft: 2, backgroundColor: theme.colors.mint, opacity: caret }}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}
