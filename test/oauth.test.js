import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestDeviceCode, pollForToken, DeviceFlowError, CLIENT_ID } from '../src/background/oauth.js';

function stubFetch(replies) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const reply = replies[calls.length - 1] ?? replies[replies.length - 1];
    return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
  };
  impl.calls = calls;
  return impl;
}

test('asks GitHub for a device code with the repo scope', async () => {
  const fetchImpl = stubFetch([
    { device_code: 'dev', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 },
  ]);
  const result = await requestDeviceCode({ fetchImpl });

  assert.equal(fetchImpl.calls[0].url, 'https://github.com/login/device/code');
  assert.deepEqual(fetchImpl.calls[0].body, { client_id: CLIENT_ID, scope: 'repo' });
  assert.deepEqual(result, {
    deviceCode: 'dev', userCode: 'ABCD-1234',
    verificationUri: 'https://github.com/login/device', interval: 5, expiresIn: 900,
  });
});

test('waits through authorization_pending until the user approves', async () => {
  const fetchImpl = stubFetch([
    { error: 'authorization_pending' },
    { error: 'authorization_pending' },
    { access_token: 'gho_token' },
  ]);
  const slept = [];
  const token = await pollForToken({
    deviceCode: 'dev', interval: 5, expiresIn: 900, fetchImpl,
    sleep: async (ms) => { slept.push(ms); },
  });

  assert.equal(token, 'gho_token');
  assert.deepEqual(slept, [5000, 5000, 5000]);
  assert.deepEqual(fetchImpl.calls[0].body, {
    client_id: CLIENT_ID,
    device_code: 'dev',
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
});

test('backs off by five seconds when GitHub says slow_down', async () => {
  const fetchImpl = stubFetch([{ error: 'slow_down' }, { access_token: 'gho_token' }]);
  const slept = [];
  await pollForToken({ deviceCode: 'dev', interval: 5, expiresIn: 900, fetchImpl, sleep: async (ms) => slept.push(ms) });
  assert.deepEqual(slept, [5000, 10000]);
});

test('gives up when the code expires', async () => {
  const fetchImpl = stubFetch([{ error: 'expired_token' }]);
  await assert.rejects(
    () => pollForToken({ deviceCode: 'dev', interval: 5, expiresIn: 900, fetchImpl, sleep: async () => {} }),
    (error) => error instanceof DeviceFlowError && error.code === 'expired_token'
  );
});

test('gives up when the user declines', async () => {
  const fetchImpl = stubFetch([{ error: 'access_denied' }]);
  await assert.rejects(
    () => pollForToken({ deviceCode: 'dev', interval: 5, expiresIn: 900, fetchImpl, sleep: async () => {} }),
    (error) => error instanceof DeviceFlowError && error.code === 'access_denied'
  );
});
