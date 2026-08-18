// Public by design: a device-flow client id carries no secret, which is exactly why
// this extension needs no server of its own.
export const CLIENT_ID = 'Ov23liCEJVOZnAhTMT4z';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export class DeviceFlowError extends Error {
  constructor(code, description) {
    super(description || code);
    this.name = 'DeviceFlowError';
    this.code = code;
  }
}

async function post(fetchImpl, url, body) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return JSON.parse(await response.text());
}

export async function requestDeviceCode({ fetchImpl = fetch } = {}) {
  const data = await post(fetchImpl, DEVICE_CODE_URL, { client_id: CLIENT_ID, scope: 'repo' });
  if (data.error) throw new DeviceFlowError(data.error, data.error_description);
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval,
    expiresIn: data.expires_in,
  };
}

export async function pollForToken({
  deviceCode,
  interval,
  expiresIn,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}) {
  const deadline = now() + expiresIn * 1000;
  let wait = interval;

  while (now() < deadline) {
    await sleep(wait * 1000);
    const data = await post(fetchImpl, ACCESS_TOKEN_URL, {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    // GitHub asks for five more seconds each time it says this.
    if (data.error === 'slow_down') { wait += 5; continue; }
    throw new DeviceFlowError(data.error || 'unknown_error', data.error_description);
  }
  throw new DeviceFlowError('expired_token', 'The device code expired before it was approved.');
}
