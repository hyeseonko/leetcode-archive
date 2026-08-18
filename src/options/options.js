const DEFAULT_REPO = { owner: 'hyeseonko', name: 'LeetCode', branch: 'main' };
const $ = (id) => document.getElementById(id);

const { repo = DEFAULT_REPO } = await chrome.storage.local.get('repo');
$('owner').value = repo.owner;
$('name').value = repo.name;
$('branch').value = repo.branch;

$('save').addEventListener('click', async () => {
  const next = {
    owner: $('owner').value.trim(),
    name: $('name').value.trim(),
    branch: $('branch').value.trim() || 'main',
  };
  if (!next.owner || !next.name) {
    $('msg').textContent = 'Owner and repository are both required.';
    return;
  }
  await chrome.storage.local.set({ repo: next });
  $('msg').textContent = `Archiving to ${next.owner}/${next.name} on ${next.branch}.`;
});

$('sign-out').addEventListener('click', async () => {
  await chrome.storage.local.remove('token');
  $('msg').textContent = 'Disconnected. Reconnect from the popup.';
});
