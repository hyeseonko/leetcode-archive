const $ = (id) => document.getElementById(id);

async function render() {
  const status = await chrome.runtime.sendMessage({ type: 'lca:status' });
  if (status.signedIn) {
    const queued = status.queued ? `, ${status.queued} waiting to retry` : '';
    const failed = status.failed ? `, ${status.failed} gave up` : '';
    $('status').textContent = `Archiving to ${status.repo.owner}/${status.repo.name}${queued}${failed}`;
    $('sign-in').hidden = true;
  } else {
    $('status').textContent = 'Not connected to GitHub.';
    $('sign-in').hidden = false;
  }
}

$('sign-in').addEventListener('click', async () => {
  $('sign-in').disabled = true;
  $('status').textContent = 'Asking GitHub for a code…';

  const started = await chrome.runtime.sendMessage({ type: 'lca:auth-start' });
  if (started.error) {
    $('status').textContent = `Could not start sign-in: ${started.error}`;
    $('sign-in').disabled = false;
    return;
  }

  $('user-code').textContent = started.userCode;
  $('verify-link').href = started.verificationUri;
  $('code-box').hidden = false;
  // The worker keeps polling even if this popup closes; reopening shows the result.
  $('status').textContent = 'Waiting for approval…';
});

$('open-options').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'lca:auth-done') render();
});

render();
