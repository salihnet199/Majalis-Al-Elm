import { TranscodeProcessor } from './transcode.processor';

describe('TranscodeProcessor', () => {
  it('uses database enum values and never fabricates a successful transcode', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const dataSource = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
      }),
    } as any;

    const processor = new TranscodeProcessor(dataSource);
    const job = {
      id: 'job-1',
      data: { assetId: 'asset-1', storageKey: 'original/audio.mp3' },
      attemptsMade: 0,
      opts: { attempts: 1 },
    } as any;

    await expect(processor.process(job)).rejects.toThrow('FFmpeg transcoding is not enabled');

    expect(queries).toHaveLength(2);
    expect(queries[0].params).toEqual(['TRANSCODING', null, 'asset-1']);
    expect(queries[1].params[0]).toBe('TRANSCODE_FAILED');
    expect(queries[1].params[2]).toBe('asset-1');
  });
});
