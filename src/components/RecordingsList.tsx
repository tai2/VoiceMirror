import { FlatList, View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Recording } from '../lib/recordings';
import type { PlayState } from '../hooks/useRecordings';
import { RecordingItem } from './RecordingItem';

// Design tokens
const colors = {
  background: '#0A0A0B',
  surface: '#141416',
  surfaceElevated: '#1C1C1F',
  border: '#2A2A2E',
  textMuted: '#71717A',
  accent: '#2DD4BF',
};

type Props = {
  recordings: Recording[];
  playState: PlayState;
  onTogglePlay: (r: Recording) => void;
  onDelete: (r: Recording) => void;
  disabled: boolean;
};

export function RecordingsList({ recordings, playState, onTogglePlay, onDelete, disabled }: Props) {
  const { t } = useTranslation();

  if (recordings.length === 0) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIconContainer}>
          <View style={styles.emptyIcon} />
          <View style={styles.emptyIconBar1} />
          <View style={styles.emptyIconBar2} />
          <View style={styles.emptyIconBar3} />
        </View>
        <Text style={styles.emptyText}>{t('recordings.empty')}</Text>
        <Text style={styles.emptyHint}>{t('recordings.empty_hint') || 'Start speaking to record'}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={recordings}
      keyExtractor={item => item.id}
      renderItem={({ item }) => (
        <RecordingItem
          recording={item}
          playState={playState}
          onTogglePlay={() => onTogglePlay(item)}
          onDelete={() => onDelete(item)}
          disabled={disabled}
        />
      )}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  list: { 
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  empty: { 
    flex: 1, 
    alignItems: 'center', 
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyIconContainer: {
    width: 64,
    height: 48,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 8,
  },
  emptyIcon: {
    width: 8,
    height: 20,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  emptyIconBar1: {
    width: 8,
    height: 32,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  emptyIconBar2: {
    width: 8,
    height: 24,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  emptyIconBar3: {
    width: 8,
    height: 16,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  emptyText: { 
    color: colors.textMuted, 
    fontSize: 15,
    fontWeight: '600',
  },
  emptyHint: {
    color: colors.border,
    fontSize: 13,
  },
});
