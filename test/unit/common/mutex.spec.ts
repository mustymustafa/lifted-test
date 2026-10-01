import { Mutex } from '../../../src/common/mutex';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('Mutex', () => {
  it('runs tasks one at a time, in arrival order', async () => {
    const mutex = new Mutex();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name} start`);
      await tick();
      log.push(`${name} end`);
    };

    await Promise.all([mutex.runExclusive(task('a')), mutex.runExclusive(task('b')), mutex.runExclusive(task('c'))]);

    expect(log).toEqual(['a start', 'a end', 'b start', 'b end', 'c start', 'c end']);
  });

  it('keeps working after a task throws, and passes the error to that caller only', async () => {
    const mutex = new Mutex();
    const failed = mutex.runExclusive(async () => {
      throw new Error('boom');
    });
    const next = mutex.runExclusive(async () => 'ok');

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
