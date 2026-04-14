import type { IRecordingsRepository } from "../../repositories/RecordingsRepository";
import type { Recording } from "../../lib/recordings";

export class StubRecordingsRepository implements IRecordingsRepository {
  private data: Recording[] = [];
  private counter = 0;

  load: jest.Mock<Promise<Recording[]>> = jest.fn(async () => [...this.data]);
  save: jest.Mock<void, [Recording[]]> = jest.fn((recordings: Recording[]) => {
    this.data = recordings;
  });
  newFilePath: jest.Mock<string> = jest.fn(
    () => `/tmp/recording_${++this.counter}.m4a`,
  );
  deleteFile: jest.Mock<void, [string]> = jest.fn();

  seed(recordings: Recording[]): void {
    this.data = recordings;
    this.load.mockResolvedValue([...this.data]);
  }
}
