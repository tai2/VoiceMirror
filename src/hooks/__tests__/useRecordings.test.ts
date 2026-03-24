import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useRecordings } from '../useRecordings';
import { StubRecordingsRepository } from '../../__tests__/stubs/stubRecordingsRepository';
import { StubAudioDecoderService, makeStubAudioBuffer } from '../../__tests__/stubs/stubAudioDecoderService';
import { makeStubAudioContext, makeStubBufferSourceNode } from '../../__tests__/stubs/stubAudioContext';
import type { Recording } from '../../lib/recordings';

function makeRecording(overrides?: Partial<Recording>): Recording {
  return {
    id: '1',
    filePath: 'file:///tmp/recording_1.m4a',
    recordedAt: '2026-03-22T10:00:00.000Z',
    durationMs: 2000,
    ...overrides,
  };
}

function setup(initialRecordings: Recording[] = []) {
  const repository = new StubRecordingsRepository();
  repository.seed(initialRecordings);
  const decoderService = new StubAudioDecoderService();
  const audioContext = makeStubAudioContext();
  const onWillPlay = jest.fn().mockResolvedValue(undefined);
  const onDidStop = jest.fn().mockResolvedValue(undefined);

  const { result } = renderHook(() =>
    useRecordings({ onWillPlay, onDidStop }, audioContext, repository, decoderService),
  );

  return { result, repository, decoderService, audioContext, onWillPlay, onDidStop };
}

describe('useRecordings — initial load', () => {
  it('loads saved recordings from repository on mount', async () => {
    const initial = [makeRecording({ id: '1' }), makeRecording({ id: '2' })];
    const { result } = setup(initial);
    await waitFor(() => expect(result.current.recordings).toHaveLength(2));
  });
});

describe('useRecordings — addRecording', () => {
  it('prepends the new entry to the recordings list', async () => {
    const { result } = setup([makeRecording({ id: 'existing' })]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    act(() => { result.current.addRecording('/tmp/new.m4a', 1500); });

    expect(result.current.recordings).toHaveLength(2);
    expect(result.current.recordings[0].durationMs).toBe(1500);
  });

  it('adds file:// prefix to the filePath', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.recordings).toHaveLength(0));

    act(() => { result.current.addRecording('/tmp/new.m4a', 1000); });

    expect(result.current.recordings[0].filePath).toBe('file:///tmp/new.m4a');
  });

  it('calls repository.save with the updated list', async () => {
    const { result, repository } = setup();
    await waitFor(() => expect(result.current.recordings).toHaveLength(0));

    act(() => { result.current.addRecording('/tmp/new.m4a', 1000); });

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save.mock.calls[0][0]).toHaveLength(1);
  });
});

describe('useRecordings — togglePlay', () => {
  it('calls onWillPlay before starting playback', async () => {
    const recording = makeRecording();
    const { result, onWillPlay } = setup([recording]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    await act(async () => { result.current.togglePlay(recording); });

    expect(onWillPlay).toHaveBeenCalledTimes(1);
  });

  it('decodes the file with the correct filePath and sampleRate', async () => {
    const recording = makeRecording();
    const { result, decoderService, audioContext } = setup([recording]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    await act(async () => { result.current.togglePlay(recording); });

    expect(decoderService.decodeAudioData).toHaveBeenCalledWith(
      recording.filePath,
      audioContext.sampleRate,
    );
  });

  it('sets playState to isPlaying for the recording', async () => {
    const recording = makeRecording({ id: 'r1' });
    const { result } = setup([recording]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    await act(async () => { result.current.togglePlay(recording); });

    expect(result.current.playState).toEqual({ recordingId: 'r1', isPlaying: true });
  });

  it('stops playback and calls onDidStop when toggled again while playing', async () => {
    const recording = makeRecording({ id: 'r1' });
    const { result, onDidStop } = setup([recording]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    await act(async () => { result.current.togglePlay(recording); });
    act(() => { result.current.togglePlay(recording); });

    expect(onDidStop).toHaveBeenCalledTimes(1);
    expect(result.current.playState).toBeNull();
  });

  it('is a no-op while decoding is in progress', async () => {
    const recording = makeRecording();
    const { result, decoderService, onWillPlay } = setup([recording]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    let resolveDecoding!: (value: Awaited<ReturnType<typeof decoderService.decodeAudioData>>) => void;
    decoderService.decodeAudioData.mockImplementation(
      () => new Promise(resolve => { resolveDecoding = resolve; }),
    );

    // First call: flush past onWillPlay so isDecodingRef becomes true, but decoding stays pending
    await act(async () => { result.current.togglePlay(recording); });
    // Second call: should be blocked by isDecodingRef guard
    await act(async () => { result.current.togglePlay(recording); });

    expect(onWillPlay).toHaveBeenCalledTimes(1);
    expect(decoderService.decodeAudioData).toHaveBeenCalledTimes(1);

    await act(async () => { resolveDecoding(makeStubAudioBuffer()); });
  });

  it('calls onDidStop and clears playState when decodeAudioData rejects', async () => {
    const recording = makeRecording();
    const { result, decoderService, onDidStop } = setup([recording]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    decoderService.decodeAudioData.mockRejectedValueOnce(new Error('decode failed'));

    await act(async () => { result.current.togglePlay(recording); });

    expect(onDidStop).toHaveBeenCalledTimes(1);
    expect(result.current.playState).toBeNull();
  });
});

describe('useRecordings — source node onEnded', () => {
  it('clears playState and calls onDidStop when playback ends naturally', async () => {
    const recording = makeRecording({ id: 'r1' });
    const { result, audioContext, onDidStop } = setup([recording]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    const stubSource = makeStubBufferSourceNode();
    (audioContext.createBufferSource as jest.Mock).mockReturnValueOnce(stubSource);

    await act(async () => { result.current.togglePlay(recording); });
    expect(result.current.playState).toEqual({ recordingId: 'r1', isPlaying: true });

    act(() => { stubSource.onEnded?.(); });

    expect(result.current.playState).toBeNull();
    expect(onDidStop).toHaveBeenCalledTimes(1);
  });
});

describe('useRecordings — deleteRecording', () => {
  it('removes the recording from the list', async () => {
    const r1 = makeRecording({ id: '1' });
    const r2 = makeRecording({ id: '2', filePath: 'file:///tmp/recording_2.m4a' });
    const { result } = setup([r1, r2]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(2));

    act(() => { result.current.deleteRecording('1'); });

    expect(result.current.recordings).toHaveLength(1);
    expect(result.current.recordings[0].id).toBe('2');
  });

  it('calls repository.deleteFile with the path (file:// stripped)', async () => {
    const r = makeRecording({ id: '1', filePath: 'file:///tmp/recording_1.m4a' });
    const { result, repository } = setup([r]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    act(() => { result.current.deleteRecording('1'); });

    expect(repository.deleteFile).toHaveBeenCalledWith('/tmp/recording_1.m4a');
  });

  it('calls repository.save with the updated list', async () => {
    const r = makeRecording({ id: '1' });
    const { result, repository } = setup([r]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    act(() => { result.current.deleteRecording('1'); });

    const lastSaveCall = repository.save.mock.calls[repository.save.mock.calls.length - 1];
    expect(lastSaveCall[0]).toHaveLength(0);
  });

  it('stops playback if the deleted recording is currently playing', async () => {
    const r = makeRecording({ id: '1' });
    const { result, onDidStop } = setup([r]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    await act(async () => { result.current.togglePlay(r); });
    expect(result.current.playState?.recordingId).toBe('1');

    act(() => { result.current.deleteRecording('1'); });

    expect(result.current.playState).toBeNull();
    expect(onDidStop).toHaveBeenCalled();
  });

  it('is a no-op for a non-existent id', async () => {
    const r = makeRecording({ id: '1' });
    const { result, repository } = setup([r]);
    await waitFor(() => expect(result.current.recordings).toHaveLength(1));

    act(() => { result.current.deleteRecording('nonexistent'); });

    expect(result.current.recordings).toHaveLength(1);
    expect(repository.deleteFile).not.toHaveBeenCalled();
  });
});
