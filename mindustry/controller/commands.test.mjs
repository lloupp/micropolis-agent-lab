import test from 'node:test';
import assert from 'node:assert/strict';
import {submitBuild, getBuild, waitForBuild} from './commands.mjs';

const TOKEN = 'Test_token_0123456789_abcdefghijklmno';
const build = {id: 'm1-test-1', block: 'conveyor', x: 17, y: 19, rotation: 0};

test('submits a typed build request only to local HTTP with bearer auth', async () => {
  let requests = 0;
  const response = await submitBuild(build, {token: TOKEN, fetchImpl: async (url, init) => {
    requests++;
    assert.equal(url, 'http://127.0.0.1:8766/v1/build');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer ' + TOKEN);
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), build);
    return {ok:true, json: async () => ({id:build.id, status:'queued'})};
  }});
  assert.equal(requests, 1);
  assert.equal(response.status, 'queued');
  assert.ok(Object.isFrozen(response));
});

test('rejects remote hosts, unusual paths, missing secrets, and untyped commands before HTTP', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('must not call'); };
  const opts = {token:TOKEN, fetchImpl};
  for (const url of ['https://127.0.0.1:8766/', 'http://example.com:8766/',
    'http://localhost:8766/', 'http://127.0.0.1:8766/evil',
    'http://127.0.0.1:8766/?p=1', 'http://guest@127.0.0.1:8766/']) {
    await assert.rejects(submitBuild(build, {...opts, url}), /loopback/);
  }
  for (const command of [{...build, block:'coreShard'}, {...build, x:-1},
    {...build, rotation:4}, {...build, id:'../../foo'}, {...build, y:0.1}]) {
    await assert.rejects(submitBuild(command, opts), /Invalid M1/);
  }
  await assert.rejects(submitBuild(build, {token:'short', fetchImpl}), /TOKEN/);
  await assert.rejects(getBuild('../id', opts), /command ID/);
  assert.equal(calls, 0);
});

test('polls status until engine reports a terminal outcome without fabricating success', async () => {
  let calls=0;
  const fetchImpl=async () => {
    calls++;
    return {ok:true, json:async()=>({id:build.id, status: calls===3?'completed':'assigned'})};
  };
  const result=await waitForBuild(build.id,{token:TOKEN,fetchImpl,maxAttempts:4,
    intervalMs:100,pause:async()=>{}});
  assert.equal(result.status,'completed');
  assert.equal(calls,3);
});

test('rejected commands and HTTP failures are visible to callers', async () => {
  const opts={token:TOKEN,fetchImpl:async()=>({ok:false,status:409,json:async()=>({error:'idempotency_conflict'})})};
  await assert.rejects(submitBuild(build,opts), /409.*idempotency_conflict/);
  const status=await waitForBuild(build.id,{token:TOKEN,maxAttempts:1,
    fetchImpl:async()=>({ok:true,json:async()=>({status:'rejected',reason:'no_idle_builder_ai'})})});
  assert.equal(status.reason,'no_idle_builder_ai');
  assert.notEqual(status.status,'completed');
});
