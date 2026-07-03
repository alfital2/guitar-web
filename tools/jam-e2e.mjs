// Two-page WebRTC loopback: page A hosts a jam, page B joins via the real
// copy-paste code flow, then A feeds a tone through its chain and we assert
// B's remote meter sees signal. True P2P (localhost candidates), no server.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
const ctxA = await b.newContext(); const ctxB = await b.newContext();
const A = await ctxA.newPage(); const B = await ctxB.newPage();
for (const [n, p] of [['A', A], ['B', B]]) p.on('pageerror', e => console.log(`[${n} pageerror]`, String(e).slice(0, 140)));

for (const p of [A, B]) {
  await p.goto('http://localhost:8000/?e2e=1', { waitUntil: 'load' });
  await p.click('#power');
  await p.waitForFunction(() => window.__neuralE2E && window.__neuralE2E.booted(), null, { timeout: 15000 });
  await p.click('#settings-toggle');
  await p.waitForTimeout(300);
}

// A creates invite
await A.click('#jam-host');
await A.waitForFunction(() => document.querySelector('#jam-out').value.length > 20, null, { timeout: 15000 });
const invite = await A.locator('#jam-out').inputValue();
console.log('invite code length:', invite.length);

// B joins with the invite → reply code
await B.click('#jam-join');
await B.locator('#jam-in').fill(invite);
await B.click('#jam-go');
await B.waitForFunction(() => document.querySelector('#jam-out').value.length > 20, null, { timeout: 15000 });
const reply = await B.locator('#jam-out').inputValue();
console.log('reply code length:', reply.length);

// A accepts the reply
await A.locator('#jam-in').fill(reply);
await A.click('#jam-go');

// both should reach connected
await A.waitForFunction(() => document.querySelector('#jam-status-text').textContent.includes('jamming'), null, { timeout: 20000 });
await B.waitForFunction(() => document.querySelector('#jam-status-text').textContent.includes('jamming'), null, { timeout: 20000 });
console.log('both pages: CONNECTED');

// A plays a tone through its live chain (e2e bridge); B's remote meter must move
await A.evaluate(() => window.__neuralE2E.feedTone(220, 0.3));
await B.waitForTimeout(2500);
const meterB = await B.evaluate(() => parseFloat(document.querySelector('#jam-meter-fill').style.width) || 0);
console.log(`B hears A: remote meter ${meterB.toFixed(1)}% (want > 3)`);

// ULTRA path must be live on both sides (raw PCM over the unreliable channel)
const statsA = await A.locator('#jam-stats').textContent();
const statsB = await B.locator('#jam-stats').textContent();
console.log('A stats:', JSON.stringify(statsA));
console.log('B stats:', JSON.stringify(statsB));
const ultraOK = statsA.includes('ULTRA') && statsB.includes('ULTRA');
console.log('ULTRA live on both sides:', ultraOK);

// Toggle B's ultra OFF → B must fall back to Opus (and still hear A)
await B.locator('#jam-ultra').uncheck();
await B.waitForTimeout(900);
const statsB2 = await B.locator('#jam-stats').textContent();
const fellBack = statsB2.includes('Opus') && !statsB2.includes('ULTRA raw');
const meterB2 = await B.evaluate(() => parseFloat(document.querySelector('#jam-meter-fill').style.width) || 0);
console.log(`B forced to Opus: ${JSON.stringify(statsB2)} fellBack=${fellBack} stillHears=${meterB2 > 3} (${meterB2.toFixed(1)}%)`);
await B.locator('#jam-ultra').check();
await B.waitForTimeout(900);
const statsB3 = await B.locator('#jam-stats').textContent();
console.log('B back to ULTRA:', statsB3.includes('ULTRA'));
await A.evaluate(() => window.__neuralE2E.stopTone());

// leave cleanly
await A.click('#jam-leave'); await B.waitForTimeout(600);
const bStatus = await B.locator('#jam-status-text').textContent();
console.log('after A leaves, B status:', JSON.stringify(bStatus));
console.log((meterB > 3 && ultraOK && fellBack && meterB2 > 3) ? 'JAM E2E PASS' : 'JAM E2E FAIL');
await b.close();
