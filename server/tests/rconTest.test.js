import { describe, expect, it, vi } from 'vitest';
import net from 'net';
import { testRconConnection } from '../services/rcon.js';
import router from '../routes/rcon.js';

function createResponse() {
  const response = {};
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    return response;
  };
  return response;
}

function getTestHandler() {
  const layer = router.stack.find(
    (entry) => entry.route?.path === '/test' && entry.route.methods.post,
  );
  // LAST entry, not the first: requireRole('admin', 'technician') is now
  // ahead of the real handler in this route's stack (role sweep), so index
  // 0 would grab the role-gate middleware instead of the route logic this
  // test actually exercises.
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function getConnectHandler() {
  const layer = router.stack.find(
    (entry) => entry.route?.path === '/connect' && entry.route.methods.post,
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function getHandler(path) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === path && entry.route.methods.post,
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('testRconConnection', () => {
  it('returns unreachable when the TCP connection cannot be established', async () => {
    // Nothing listens on this loopback port in the test environment, so the
    // connection is refused (or times out) rather than authenticating.
    const result = await testRconConnection({
      host: '127.0.0.1',
      port: 39822,
      password: 'whatever',
      timeoutMs: 1000,
    });
    expect(result).toEqual({
      success: false,
      error: 'unreachable',
      detail: 'Unreachable: check host and port',
    });
  });

  it('returns auth_failed when TCP connects but RCON auth never completes', async () => {
    // A bare TCP server that accepts the connection but never speaks the
    // RCON protocol -- authenticate() times out and rejects, exercising the
    // auth_failed branch without needing a real RCON server.
    const server = net.createServer((socket) => socket.on('data', () => {}));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const result = await testRconConnection({
        host: '127.0.0.1',
        port,
        password: 'wrong-password',
        timeoutMs: 300,
      });
      expect(result).toEqual({
        success: false,
        error: 'auth_failed',
        detail: 'Authentication failed: check RCON password',
      });
    } finally {
      server.close();
    }
  });
});

describe('POST /api/rcon/test route validation', () => {
  it('rejects an invalid host format with 400', async () => {
    const res = createResponse();
    await getTestHandler()(
      { body: { host: 'not a host!', port: 27015, password: 'x' } },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: 'invalid_input',
      detail: 'Invalid host format',
    });
  });

  it('rejects an out-of-range port with 400', async () => {
    const res = createResponse();
    await getTestHandler()(
      { body: { host: '127.0.0.1', port: 99999, password: 'x' } },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.detail).toBe('Invalid port (1-65535)');
  });

  it('rejects a port with trailing junk instead of accepting its numeric prefix', async () => {
    const res = createResponse();
    await getTestHandler()(
      { body: { host: '127.0.0.1', port: '27015junk', password: 'x' } },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.detail).toBe('Invalid port (1-65535)');
  });

  it('reports unreachable for a closed local port via the real handler', async () => {
    const res = createResponse();
    await getTestHandler()(
      { body: { host: '127.0.0.1', port: 39822, password: 'x' } },
      res,
    );
    expect(res.body).toEqual({
      success: false,
      error: 'unreachable',
      detail: 'Unreachable: check host and port',
    });
  });
});

describe('POST /api/rcon/connect route updates', () => {
  it('applies an explicitly empty password instead of retaining the old one', async () => {
    const updateConfig = vi.fn();
    const connect = vi.fn(async () => false);
    const res = createResponse();

    await getConnectHandler()(
      {
        body: { password: '' },
        app: { get: () => ({ updateConfig, connect }) },
      },
      res,
    );

    expect(updateConfig).toHaveBeenCalledWith(undefined, undefined, '');
    expect(res.statusCode).toBe(503);
  });

  it('returns a client error for a missing body', async () => {
    const updateConfig = vi.fn();
    const res = createResponse();

    await getConnectHandler()(
      {
        body: null,
        app: { get: () => ({ updateConfig, connect: vi.fn() }) },
      },
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(updateConfig).not.toHaveBeenCalled();
  });
});

describe('RCON route malformed request handling', () => {
  it('returns 400 for a missing test body', async () => {
    const res = createResponse();

    await getTestHandler()({ body: null }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.detail).toBe('Invalid host format');
  });

  it('returns 400 for a non-string execute command without throwing', async () => {
    const res = createResponse();

    await getHandler('/execute')(
      { body: { command: 123 }, app: { get: vi.fn() } },
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('RCON_COMMAND_INVALID');
  });
});
