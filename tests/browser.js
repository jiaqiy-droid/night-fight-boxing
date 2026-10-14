'use strict';
// Minimal Chrome DevTools Protocol driver (no npm packages): starts a static
// file server and headless Chrome, then lets a test send real keyboard
// events, run JavaScript in the page, and save screenshots.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.png': 'image/png' };

function serve(port) {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(options) {
  options = options || {};
  const port = 9300 + Math.floor(Math.random() * 500);
  const httpPort = 8300 + Math.floor(Math.random() * 500);
  const server = await serve(httpPort);
  const profile = fs.mkdtempSync('/tmp/boxing-chrome-');
  const width = options.width || 1280;
  const height = options.height || 720;
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
    '--window-size=' + width + ',' + height, '--hide-scrollbars', '--mute-audio', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(150);
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
      target = list.find((t) => t.type === 'page');
    } catch (error) { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else if (data.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + JSON.stringify(data.params.exceptionDetails.exception && data.params.exceptionDetails.exception.description || data.params.exceptionDetails.text));
    } else if (data.method === 'Runtime.consoleAPICalled') {
      logs.push(data.params.type + ': ' + data.params.args.map((a) => a.value !== undefined ? a.value : a.description).join(' '));
    }
  });
  const send = (method, params) => new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const page = {
    logs,
    url: 'http://127.0.0.1:' + httpPort + '/index.html',
    send,
    async goto(url) {
      await send('Page.navigate', { url: url || page.url });
      await sleep(1200);
    },
    async eval(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.result && result.result.exceptionDetails) throw new Error('eval failed: ' + expression + '\n' + JSON.stringify(result.result.exceptionDetails));
      return result.result && result.result.result ? result.result.result.value : undefined;
    },
    async key(code, type, extra) {
      const keys = {
        Space: [' ', 32], Enter: ['Enter', 13], Escape: ['Escape', 27], Backspace: ['Backspace', 8], Delete: ['Delete', 46],
        ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
        Tab: ['Tab', 9], ShiftLeft: ['Shift', 16]
      };
      let key;
      let keyCode;
      if (keys[code]) { key = keys[code][0]; keyCode = keys[code][1]; } else { key = code.replace('Key', '').toLowerCase(); keyCode = key.toUpperCase().charCodeAt(0); }
      const base = { code, key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
      Object.assign(base, extra || {});
      if (type !== 'up') await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown', text: key.length === 1 ? key : undefined }, base));
      if (type !== 'down') await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
    },
    async tap(code, holdMs) {
      await page.key(code, 'down');
      await sleep(holdMs || 40);
      await page.key(code, 'up');
    },
    async screenshot(file) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    },
    async resize(w, h) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
    },
    async close() {
      ws.close();
      const exited = new Promise((resolve) => chrome.once('exit', resolve));
      chrome.kill();
      await Promise.race([exited, sleep(3000)]);
      server.close();
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (error) { /* Chrome still releasing files */ }
    }
  };
  return page;
}

module.exports = { launch, sleep };
