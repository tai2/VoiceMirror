jest.mock('../sentryHelpers', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import { loadRecordings, saveRecordings, newFilePath } from '../recordings';

const store: Record<string, string> = {};

jest.mock('expo-file-system', () => {
  class MockFile {
    private key: string;
    constructor(parentOrUri: { uri?: string } | string, name?: string) {
      if (typeof parentOrUri === 'string') {
        this.key = parentOrUri.replace('file://', '');
      } else {
        const parentUri = (parentOrUri as { uri?: string }).uri ?? '';
        this.key = `${parentUri.replace('file://', '')}/${name ?? ''}`;
      }
    }
    get uri() { return 'file://' + this.key; }
    get exists() { return this.key in store; }
    async text() { return store[this.key] ?? '[]'; }
    write(content: string) { store[this.key] = content; }
    delete() { delete store[this.key]; }
  }

  return {
    Paths: { document: '/mock/documents' },
    Directory: class MockDirectory {
      parent: string;
      name: string;
      constructor(parent: { uri?: string } | string, name: string) {
        this.parent = typeof parent === 'string' ? parent : (parent as { uri?: string }).uri ?? '';
        this.name = name;
      }
      get uri() { return `file://${this.parent}/${this.name}`; }
      get exists() {
        return (`${this.parent}/${this.name}`) in store || true;
      }
      create(_opts?: { intermediates?: boolean }) {}
      list() {
        const dirPath = `${this.parent}/${this.name}`;
        return Object.keys(store)
          .filter(k => k.startsWith(dirPath + '/') && k.endsWith('.m4a'))
          .map(k => new MockFile('file://' + k));
      }
    },
    File: MockFile,
  };
});

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
});

describe('loadRecordings', () => {
  it('returns empty array when index.json does not exist', async () => {
    const result = await loadRecordings();
    expect(result).toEqual([]);
  });

  it('returns parsed recordings when index.json exists', async () => {
    const recordings = [
      { id: '1', filePath: 'file:///a.m4a', recordedAt: '2026-01-01T00:00:00.000Z', durationMs: 1000 },
    ];
    store['/a.m4a'] = 'audio-data';
    saveRecordings(recordings);
    const loaded = await loadRecordings();
    expect(loaded).toEqual(recordings);
  });
});

describe('saveRecordings + loadRecordings', () => {
  it('round-trips the full recordings array', async () => {
    const recordings = [
      { id: '1', filePath: 'file:///a.m4a', recordedAt: '2026-01-01T00:00:00.000Z', durationMs: 1000 },
      { id: '2', filePath: 'file:///b.m4a', recordedAt: '2026-01-02T00:00:00.000Z', durationMs: 2000 },
    ];
    store['/a.m4a'] = 'audio-data';
    store['/b.m4a'] = 'audio-data';
    saveRecordings(recordings);
    const loaded = await loadRecordings();
    expect(loaded).toEqual(recordings);
  });
});

describe('loadRecordings — stale entry cleanup', () => {
  it('filters out recordings whose files do not exist on disk', async () => {
    const recordings = [
      { id: '1', filePath: 'file:///mock/documents/recordings/a.m4a', recordedAt: '2026-01-01T00:00:00.000Z', durationMs: 1000 },
      { id: '2', filePath: 'file:///mock/documents/recordings/b.m4a', recordedAt: '2026-01-02T00:00:00.000Z', durationMs: 2000 },
    ];
    saveRecordings(recordings);

    store['/mock/documents/recordings/a.m4a'] = 'audio-data';

    const loaded = await loadRecordings();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('1');
  });

  it('persists the cleaned-up list when stale entries are found', async () => {
    const recordings = [
      { id: '1', filePath: 'file:///mock/documents/recordings/a.m4a', recordedAt: '2026-01-01T00:00:00.000Z', durationMs: 1000 },
    ];
    saveRecordings(recordings);

    const loaded = await loadRecordings();
    expect(loaded).toHaveLength(0);

    const reloaded = await loadRecordings();
    expect(reloaded).toHaveLength(0);
  });

  it('logs a warning for each stale entry', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const recordings = [
      { id: '1', filePath: 'file:///mock/documents/recordings/gone.m4a', recordedAt: '2026-01-01T00:00:00.000Z', durationMs: 1000 },
    ];
    saveRecordings(recordings);

    await loadRecordings();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Removing stale entry'),
      );
    warnSpy.mockRestore();
  });
});

describe('loadRecordings — orphan cleanup', () => {
  it('deletes .m4a files in the recordings directory that are not in the index', async () => {
    const recordings = [
      { id: '1', filePath: 'file:///mock/documents/recordings/a.m4a', recordedAt: '2026-01-01T00:00:00.000Z', durationMs: 1000 },
    ];
    saveRecordings(recordings);
    store['/mock/documents/recordings/a.m4a'] = 'audio-data';
    store['/mock/documents/recordings/orphan.m4a'] = 'orphan-audio-data';

    await loadRecordings();

    expect(store['/mock/documents/recordings/a.m4a']).toBe('audio-data');
    expect('/mock/documents/recordings/orphan.m4a' in store).toBe(false);
  });

  it('does not delete .m4a files that are referenced by the index', async () => {
    const recordings = [
      { id: '1', filePath: 'file:///mock/documents/recordings/a.m4a', recordedAt: '2026-01-01T00:00:00.000Z', durationMs: 1000 },
      { id: '2', filePath: 'file:///mock/documents/recordings/b.m4a', recordedAt: '2026-01-02T00:00:00.000Z', durationMs: 2000 },
    ];
    saveRecordings(recordings);
    store['/mock/documents/recordings/a.m4a'] = 'audio-data-a';
    store['/mock/documents/recordings/b.m4a'] = 'audio-data-b';

    await loadRecordings();

    expect(store['/mock/documents/recordings/a.m4a']).toBe('audio-data-a');
    expect(store['/mock/documents/recordings/b.m4a']).toBe('audio-data-b');
  });

  it('does not delete non-.m4a files in the recordings directory', async () => {
    saveRecordings([]);
    store['/mock/documents/recordings/notes.txt'] = 'some notes';

    await loadRecordings();

    expect(store['/mock/documents/recordings/notes.txt']).toBe('some notes');
  });

  it('logs a warning for each orphaned file deleted', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    saveRecordings([]);
    store['/mock/documents/recordings/orphan.m4a'] = 'orphan-data';

    await loadRecordings();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Deleting orphaned file'),
    );
    warnSpy.mockRestore();
  });
});

describe('newFilePath', () => {
  it('returns a string ending in .m4a', () => {
    const path = newFilePath();
    expect(path).toMatch(/\.m4a$/);
  });

  it('returns unique paths on successive calls', () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    const p1 = newFilePath();
    const p2 = newFilePath();
    expect(p1).not.toBe(p2);
  });
});
