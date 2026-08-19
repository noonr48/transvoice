const controlId = process.argv[2];
if (!controlId || !/^[a-z0-9-]+$/i.test(controlId)) {
  throw new Error('Usage: node studio/code/cdp-click.mjs <control-id>');
}

const cdpUrl = process.env.TRANSVOICE_CDP_URL || 'http://127.0.0.1:9223';
const targets = await fetch(`${cdpUrl}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === 'page' && candidate.url.includes('/app'));
if (!target) throw new Error('Voice Tutor WebView target not found.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

const result = await new Promise((resolve, reject) => {
  const id = 1;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== id) return;
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  socket.send(JSON.stringify({
    id,
    method: 'Runtime.evaluate',
    params: {
      expression: `(() => {
        const element = document.getElementById(${JSON.stringify(controlId)});
        if (!(element instanceof HTMLElement)) return { clicked: false, reason: 'missing' };
        const disabled = element instanceof HTMLButtonElement
          ? element.disabled
          : element.getAttribute('aria-disabled') === 'true';
        if (disabled) return {
          clicked: false,
          reason: 'disabled',
          text: element.textContent.trim(),
          state: element.getAttribute('data-state'),
        };
        element.click();
        return {
          clicked: true,
          text: element.textContent.trim(),
          state: element.getAttribute('data-state'),
          ariaLabel: element.getAttribute('aria-label'),
        };
      })()`,
      returnByValue: true,
    },
  }));
});

console.log(JSON.stringify(result.result.value, null, 2));
socket.close();
