import { FlatList, View, Text, StyleSheet } from 'react-native';
import type { Recording } from '../lib/recordings';
import type { PlayState } from '../hooks/useRecordings';
import { RecordingItem } from './RecordingItem';

type Props = {
  recordings: Recording[];
  playState: PlayState;
  onTogglePlay: (r: Recording) => void;
  disabled: boolean;
};

export function RecordingsList({ recordings, playState, onTogglePlay, disabled }: Props) {
  if (recordings.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No recordings yet</Text>
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
