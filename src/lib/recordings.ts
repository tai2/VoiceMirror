import { Directory, File, Paths } from 'expo-file-system';

export interface Recording {
  id: string;
  filePath: string;
  recordedAt: string;
  durationMs: number;
}

const recordingsDir = (): Directory => new Directory(Paths.document, 'recordings');
const indexFile = (): File => new File(recordingsDir(), 'index.json');

export function ensureDir(): void {
  const dir = recordingsDir();
  if (!dir.exists) dir.create({ intermediates: true });
}

export async function loadRecordings(): Promise<Recording[]> {
  ensureDir();
  const file = indexFile();
  if (!file.exists) return [];
  const json = await file.text();
  const recordings = JSON.parse(json) as Recording[];

  const valid: Recording[] = [];
  for (const recording of recordings) {
    const audioFile = new File(recording.filePath);
    if (audioFile.exists) {
      valid.push(recording);
    } else {
      console.warn(
        `[recordings] Removing stale entry: ${recording.filePath} (file not found on disk)`,
      );
    }
  }

  if (valid.length !== recordings.length) {
    saveRecordings(valid);
  }

  return valid;
}

export function saveRecordings(recordings: Recording[]): void {
  ensureDir();
  indexFile().write(JSON.stringify(recordings));
}

export function newFilePath(): string {
  ensureDir();
  const dir = recordingsDir();
  const file = new File(dir, `recording_${Date.now()}.m4a`);
  return file.uri.replace('file://', '');
}
