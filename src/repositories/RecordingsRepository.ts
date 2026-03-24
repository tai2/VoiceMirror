import { File } from 'expo-file-system';
import {
  type Recording,
  loadRecordings,
  saveRecordings,
  newFilePath as libNewFilePath,
} from '../lib/recordings';

export type { Recording };

export interface IRecordingsRepository {
  load(): Promise<Recording[]>;
  save(recordings: Recording[]): void;
  newFilePath(): string;
  deleteFile(path: string): void;
}

export class RealRecordingsRepository implements IRecordingsRepository {
  load(): Promise<Recording[]> {
    return loadRecordings();
  }

  save(recordings: Recording[]): void {
    saveRecordings(recordings);
  }

  newFilePath(): string {
    return libNewFilePath();
  }

  deleteFile(path: string): void {
    const file = new File('file://' + path);
    if (file.exists) file.delete();
  }
}
