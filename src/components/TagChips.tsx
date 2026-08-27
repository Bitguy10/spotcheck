/**
 * Optional flavor chips under the gauge. Max 2 selectable, fully skippable,
 * contextual to where on the gauge the user tapped.
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { MAX_TAGS, type Tag } from '@/lib/tags';
import { useTheme } from '@/theme/ThemeProvider';

type TagChipsProps = {
  options: Tag[];
  selected: Tag[];
  onToggle: (tag: Tag) => void;
  accent: string;
};

export function TagChips({ options, selected, onToggle, accent }: TagChipsProps) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((tag) => {
        const active = selected.includes(tag);
        const blocked = !active && selected.length >= MAX_TAGS;
        return (
          <Pressable
            key={tag}
            disabled={blocked}
            onPress={() => onToggle(tag)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? accent : theme.line,
              backgroundColor: active ? `${accent}22` : 'transparent',
              opacity: blocked ? 0.4 : 1,
            }}
          >
            <Text style={{ color: active ? accent : theme.muted, fontSize: 13, fontWeight: active ? '700' : '500' }}>
              {tag}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default TagChips;
