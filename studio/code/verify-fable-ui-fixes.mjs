const cdpUrl = process.env.TRANSVOICE_CDP_URL || 'http://127.0.0.1:9223';
const targets = await fetch(`${cdpUrl}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === 'page' && candidate.url.includes('/app'));
if (!target) throw new Error('Voice Tutor WebView target not found');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let requestId = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  const waiter = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++requestId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

const probeExpression = String.raw`(() => {
  const rect = (element) => {
    const value = element?.getBoundingClientRect();
    return value ? {
      left: Math.round(value.left), top: Math.round(value.top),
      right: Math.round(value.right), bottom: Math.round(value.bottom),
      width: Math.round(value.width), height: Math.round(value.height),
    } : null;
  };
  const visible = (element) => {
    const value = rect(element);
    return Boolean(value && value.width > 0 && value.height > 0);
  };
  const line = document.getElementById('voice-active-line-text');
  const strip = document.getElementById('voice-lesson-card-strip');
  const empty = strip?.querySelector('.voice-lesson-card-empty');
  const thread = document.getElementById('voice-coach-thread');
  const lastBubble = thread?.lastElementChild;
  const input = document.getElementById('voice-coach-question');
  const orb = document.querySelector('.tv-orb-wrap');
  const lastStyle = lastBubble ? getComputedStyle(lastBubble) : null;
  return {
    viewport: {
      layoutWidth: innerWidth,
      layoutHeight: innerHeight,
      visualWidth: Math.round(visualViewport?.width || innerWidth),
      visualHeight: Math.round(visualViewport?.height || innerHeight),
    },
    document: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      scrollX,
      scrollY,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      verticalOverflow: document.documentElement.scrollHeight > (visualViewport?.height || innerHeight) + 2,
    },
    practiceLine: line?.textContent?.trim() || null,
    practiceLineVisible: visible(line),
    cardStrip: strip?.textContent?.trim() || null,
    cardUsesFallback: Boolean(empty),
    cardVisible: visible(strip),
    coachReply: lastBubble?.textContent?.trim().replace(/\s+/g, ' ') || null,
    coachReplyRect: rect(lastBubble),
    coachReplyScrollHeight: lastBubble?.scrollHeight || null,
    coachReplyClientHeight: lastBubble?.clientHeight || null,
    coachReplyClipped: Boolean(lastBubble && lastBubble.scrollHeight > lastBubble.clientHeight + 1),
    coachReplyLineClamp: lastStyle?.webkitLineClamp || null,
    input: input ? {
      visible: visible(input),
      disabled: input.disabled,
      placeholder: input.placeholder,
      focused: document.activeElement === input,
      rect: rect(input),
    } : null,
    orbVisible: visible(orb),
    focusReplacementActive: document.activeElement === input && !visible(orb),
    scrollers: Array.from(document.querySelectorAll('*')).filter((element) => {
      const style = getComputedStyle(element);
      return element.scrollTop !== 0
        || ((style.overflowY === 'auto' || style.overflowY === 'scroll')
          && element.scrollHeight > element.clientHeight + 1);
    }).map((element) => element.id || element.className || element.tagName).slice(0, 10),
  };
})()`;

async function probe() {
  const result = await call('Runtime.evaluate', { expression: probeExpression, returnByValue: true });
  return result.result.value;
}

let before = await probe();
const readyDeadline = Date.now() + 8000;
while ((!before.input?.visible || !before.cardVisible) && Date.now() < readyDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  before = await probe();
}
const center = before.input?.rect;
if (!center || !before.input.visible) {
  socket.close();
  throw new Error(`Coach reply input is not visible: ${JSON.stringify(before.input)}`);
}

await call('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: Math.round((center.left + center.right) / 2),
  y: Math.round((center.top + center.bottom) / 2),
  button: 'left',
  clickCount: 1,
});
await call('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: Math.round((center.left + center.right) / 2),
  y: Math.round((center.top + center.bottom) / 2),
  button: 'left',
  clickCount: 1,
});
await new Promise((resolve) => setTimeout(resolve, 500));
const focused = await probe();
await call('Runtime.evaluate', {
  expression: "document.getElementById('voice-coach-question')?.blur()",
  returnByValue: true,
});

const failures = [];
const waitingCopy = 'Waiting for your first line...';
if (before.cardUsesFallback && before.practiceLine && before.practiceLine !== waitingCopy
  && before.cardStrip !== before.practiceLine) {
  failures.push('card fallback does not match the active practice line');
}
if (!before.cardVisible) failures.push('practice card is not visible');
if (before.coachReplyClipped) failures.push('latest coach reply is clipped');
if (before.coachReplyLineClamp && before.coachReplyLineClamp !== 'none') {
  failures.push(`latest coach reply still has line clamp ${before.coachReplyLineClamp}`);
}
if (!before.input?.visible || before.input.disabled) failures.push('typed reply path is unavailable');
if (before.input?.rect?.bottom > before.viewport.visualHeight + 1) failures.push('typed reply path extends below the visual viewport');
if (!/reply|ask/i.test(before.input?.placeholder || '')) failures.push('typed reply path is not discoverable');
if (!focused.input?.focused) failures.push('physical input tap did not focus the typed reply path');
if (!focused.focusReplacementActive) failures.push('keyboard focus did not enter the fixed-height replacement state');
if (before.document.horizontalOverflow || focused.document.horizontalOverflow) failures.push('horizontal overflow detected');
if (before.scrollers.length || focused.scrollers.length) failures.push('scrollable descendant detected');

console.log(JSON.stringify({
  gate: failures.length ? 'FAIL' : 'PASS',
  page: target.url,
  before,
  focused,
  failures,
}, null, 2));
socket.close();
if (failures.length) process.exitCode = 1;
