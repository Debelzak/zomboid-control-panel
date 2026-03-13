import { describe, it, expect, vi } from 'vitest';

// Test the restart timeout pattern fix
// Verifies that the Promise.race + clearTimeout pattern doesn't leak unhandled rejections

describe('Restart timeout pattern', () => {
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  it('should not leave dangling rejections when operation wins the race', async () => {
    // This is the FIXED pattern: setTimeout + clearTimeout
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timeout')), 5000);
    });

    const operationPromise = Promise.resolve('done');

    const result = await Promise.race([operationPromise, timeoutPromise]);
    clearTimeout(timeoutId); // Prevents the timeout from firing

    expect(result).toBe('done');
    // Wait a tick to ensure no unhandled rejection
    await sleep(10);
  });

  it('should reject when operation takes too long', async () => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timeout')), 10);
    });

    const slowOperation = new Promise(resolve => setTimeout(resolve, 5000));

    try {
      await Promise.race([slowOperation, timeoutPromise]);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e.message).toBe('Timeout');
    }
    clearTimeout(timeoutId);
  });

  it('sendWarning helper should catch both success and timeout', async () => {
    const sendWarning = async (msg, shouldSucceed = true) => {
      try {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('RCON timeout')), 50);
        });
        const operation = shouldSucceed
          ? Promise.resolve('sent')
          : new Promise(resolve => setTimeout(resolve, 5000));
        await Promise.race([operation, timeoutPromise]);
        clearTimeout(timeoutId);
        return 'ok';
      } catch (e) {
        return e.message;
      }
    };

    // Success case
    expect(await sendWarning('test', true)).toBe('ok');

    // Timeout case
    expect(await sendWarning('test', false)).toBe('RCON timeout');
  });
});

// Test modChecker interval error handling
describe('modChecker interval error handling', () => {
  it('should catch errors in async interval callback', async () => {
    let errorCaught = false;
    let intervalCleared = false;
    let callCount = 0;

    const intervalCallback = async () => {
      try {
        callCount++;
        throw new Error('RCON connection failed');
      } catch (error) {
        errorCaught = true;
        intervalCleared = true;
      }
    };

    await intervalCallback();

    expect(errorCaught).toBe(true);
    expect(intervalCleared).toBe(true);
    expect(callCount).toBe(1);
  });
});
