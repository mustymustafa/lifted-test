import { loadConfig } from '../../src/common/config';

describe('loadConfig', () => {
  it('uses defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      holdMs: 600_000,
      sweepIntervalMs: 30_000,
      seedPath: 'data/seed.json',
    });
  });

  it('reads and converts environment variables', () => {
    const config = loadConfig({ PORT: '4000', HOLD_MINUTES: '2', SWEEP_INTERVAL_SECONDS: '0' });
    expect(config).toMatchObject({ port: 4000, holdMs: 120_000, sweepIntervalMs: 0 });
  });

  it.each([{ PORT: 'abc' }, { PORT: '-1' }, { HOLD_MINUTES: '0' }, { SWEEP_INTERVAL_SECONDS: '-5' }])(
    'fails fast on %o',
    (env) => {
      expect(() => loadConfig(env)).toThrow();
    },
  );
});
