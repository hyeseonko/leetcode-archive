// The solution is already committed by the time this appears. A note is an addition,
// never a gate — ignoring this panel must not cost you the archive entry.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'lca:committed') return;
  show(message.job);
});

function show(job) {
  document.getElementById('lca-note')?.remove();

  const panel = document.createElement('div');
  panel.id = 'lca-note';
  panel.innerHTML = `
    <p>Archived. Anything worth remembering?</p>
    <textarea rows="3" placeholder="e.g. sort the counter into a tuple key"></textarea>
    <div><button data-act="save">Save note</button><button data-act="close">Dismiss</button></div>
  `;

  const close = () => panel.remove();
  panel.querySelector('[data-act="close"]').addEventListener('click', close);
  panel.querySelector('[data-act="save"]').addEventListener('click', () => {
    const note = panel.querySelector('textarea').value.trim();
    if (note) chrome.runtime.sendMessage({ type: 'lca:note', job, note });
    close();
  });

  document.body.appendChild(panel);
  setTimeout(() => {
    if (!panel.querySelector('textarea')?.value) close();
  }, 60000);
}
