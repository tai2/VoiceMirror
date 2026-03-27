import { FlatList, View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Recording } from '../lib/recordings';
import type { PlayState } from '../hooks/useRecordings';
import { RecordingItem } from './RecordingItem';

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
        <Text style={styles.emptyText}>{t('recordings.empty')}</Text>
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
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#BBB', fontSize: 14 },
});
