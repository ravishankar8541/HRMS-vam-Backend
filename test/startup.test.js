const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sources = new Map([
  ['api/index.js', fs.readFileSync(path.join(root, 'api/index.js'), 'utf8')],
  ['server.js', fs.readFileSync(path.join(root, 'server.js'), 'utf8')],
]);

// Execute the real entry files with isolated dependencies. No application .env,
// database, HTTP listener, route module, or monthly scheduler is loaded here.
function createRuntime({ env = {}, parentFilename = '/test/loader.js' } = {}) {
  const events = [];
  const exits = [];
  const dotenvCalls = [];
  const handlers = new Map();
  const modules = new Map();
  const connection = { readyState: 0 };
  let resolveDatabase;
  let rejectDatabase;
  const database = new Promise((resolve, reject) => {
    resolveDatabase = resolve;
    rejectDatabase = reject;
  });
  const server = {};
  const app = {
    use() {},
    get(route, handler) { handlers.set(route, handler); },
    listen(port, callback) {
      events.push('listen');
      if (typeof callback === 'function') callback();
      return server;
    },
  };
  const noop = () => {};
  const express = () => app;
  express.json = () => noop;
  express.static = () => noop;
  const processStub = {
    env: { JWT_SECRET: 'startup-test-only', ...env },
    version: 'test-runtime',
    exit(code) { exits.push(code); },
  };
  const loader = { filename: parentFilename };

  function load(name, parent = loader) {
    if (modules.has(name)) return modules.get(name).exports;
    const module = { exports: {}, filename: path.join(root, name), parent };
    modules.set(name, module);
    function requireStub(id) {
      if (id === './api/index') return load('api/index.js', module);
      if (id === 'dotenv') return { config(options) { dotenvCalls.push(options); } };
      if (id === 'path' || id === 'node:path') return path;
      if (id === 'express') return express;
      if (id === 'cors') return () => noop;
      if (id === 'mongoose') return { connection };
      if (id === '../config/db') return async () => {
        events.push('db:start');
        connection.readyState = 2;
        await database;
        connection.readyState = 1;
        events.push('db:ready');
      };
      if (id === '../middleware/auth') return { authenticate: noop, staffOnly: noop };
      if (id.startsWith('../routes/')) return noop;
      if (id === '../utils/monthlySalaryScheduler') {
        return { start() { events.push('scheduler:start'); } };
      }
      throw new Error(`Unexpected startup dependency: ${id}`);
    }
    requireStub.main = loader;
    vm.runInNewContext(sources.get(name), {
      require: requireStub,
      module,
      exports: module.exports,
      __filename: module.filename,
      __dirname: path.dirname(module.filename),
      process: processStub,
      console: { log: noop, error: noop },
    }, { filename: module.filename });
    return module.exports;
  }

  // LiteSpeed calls this immediately after require(), before async startup has
  // completed. Exposing Express.listen here reproduces the production failure.
  function liteSpeedFallback(exported) {
    if (!events.includes('listen') && typeof exported.listen === 'function') {
      exported.listen(3000);
    }
  }

  function health() {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    assert.equal(typeof handlers.get('/health'), 'function');
    handlers.get('/health')({}, response);
    return response;
  }

  return {
    load, liteSpeedFallback, health, events, exits, dotenvCalls,
    connection, app, server, resolveDatabase, rejectDatabase,
  };
}

test('ordinary app import loads the project .env path without starting services', () => {
  const runtime = createRuntime();
  const exported = runtime.load('api/index.js');
  assert.equal(exported, runtime.app);
  assert.equal(typeof exported.startServer, 'function');
  assert.deepEqual(runtime.events, []);
  assert.deepEqual(runtime.exits, []);
  assert.equal(runtime.dotenvCalls.length, 1);
  assert.equal(runtime.dotenvCalls[0].path, path.join(root, '.env'));
});

for (const [indicator, options] of [
  ['LSNODE_ROOT', { env: { LSNODE_ROOT: '/example/backend' } }],
  ['LSNODE_STARTUP_FILE', { env: { LSNODE_STARTUP_FILE: 'api/index.js' } }],
  ['LSNODE_SOCKET', { env: { LSNODE_SOCKET: '/example/backend.sock' } }],
  ['lsnode.js parent without environment markers', { parentFilename: '/usr/local/lsws/fcgi-bin/lsnode.js' }],
]) {
  test(`LiteSpeed ${indicator} waits for MongoDB without a fallback or duplicate listener`, async () => {
    const runtime = createRuntime(options);
    const exported = runtime.load('api/index.js');
    assert.equal(typeof exported.startServer, 'function');
    assert.equal(typeof exported.listen, 'undefined');
    runtime.liteSpeedFallback(exported);
    assert.deepEqual(runtime.events, ['db:start']);
    const startup = exported.startServer();
    assert.equal(exported.startServer(), startup);
    runtime.resolveDatabase();
    assert.equal(await startup, runtime.server);
    runtime.liteSpeedFallback(exported);
    assert.equal(await exported.startServer(), runtime.server);
    assert.deepEqual(runtime.events, ['db:start', 'db:ready', 'listen', 'scheduler:start']);
    assert.deepEqual(runtime.exits, []);
  });
}

for (const [mode, options] of [
  ['normal require', {}],
  ['LiteSpeed with automatic index startup', { env: { LSNODE_ROOT: '/example/backend' } }],
]) {
  test(`server.js startup is idempotent under ${mode}`, async () => {
    const runtime = createRuntime(options);
    const entry = runtime.load('server.js');
    assert.equal(typeof entry.listen, 'undefined');
    runtime.liteSpeedFallback(entry);
    assert.deepEqual(runtime.events, ['db:start']);
    const api = runtime.load('api/index.js');
    const startup = api.startServer();
    assert.equal(api.startServer(), startup);
    runtime.resolveDatabase();
    assert.equal(await startup, runtime.server);
    assert.deepEqual(runtime.events, ['db:start', 'db:ready', 'listen', 'scheduler:start']);
    assert.deepEqual(runtime.exits, []);
  });
}

test('a failed database connection exits LiteSpeed startup without exposing a listener', async () => {
  const runtime = createRuntime({ parentFilename: '/usr/local/lsws/fcgi-bin/lsnode.js' });
  const exported = runtime.load('api/index.js');
  runtime.liteSpeedFallback(exported);
  const startup = exported.startServer();
  runtime.rejectDatabase(new Error('Test database unavailable'));
  await assert.rejects(startup, /Test database unavailable/);
  await new Promise(setImmediate);
  assert.deepEqual(runtime.events, ['db:start']);
  assert.deepEqual(runtime.exits, [1]);
});

test('health reports database readiness and notices loss of the connection', () => {
  const runtime = createRuntime();
  runtime.load('api/index.js');
  for (const [readyState, database] of [
    [0, 'disconnected'],
    [2, 'connecting'],
    [1, 'connected'],
    [3, 'disconnecting'],
    [0, 'disconnected'],
  ]) {
    runtime.connection.readyState = readyState;
    const response = runtime.health();
    assert.equal(response.statusCode, readyState === 1 ? 200 : 503);
    assert.equal(response.body.status, readyState === 1 ? 'active' : 'unavailable');
    assert.equal(response.body.database, database);
    assert.ok(Number.isFinite(new Date(response.body.timestamp).getTime()));
  }
  assert.deepEqual(runtime.events, []);
});
