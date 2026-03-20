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
  return JSON.parse(json) as Recording[];
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
