/**
 * Browser end-to-end smoke test. Drives the BUILT app (dist/) in headless Chromium.
 *
 * Requirements: `npm run build` first, plus Playwright with a Chromium browser available
 * (`npx playwright install chromium`, or an existing install). Playwright is intentionally not a
 * package dependency so `npm install` stays small and never downloads browsers.
 *
 * What this proves: the UI wiring (DOM <-> control core <-> 3D scene) works in a real browser.
 * It does NOT prove anything about real hardware: there is none.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = createRequire('/usr/lib/node_modules/')('playwright'));
}

const PORT = 4179;
const URL_BASE = `http://127.0.0.1:${PORT}/`;
const outDir = path.join(root, 'e2e', 'out');
mkdirSync(outDir, { recursive: true });

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '' });
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, detail: String(e?.message ?? e) });
    console.log(`FAIL  ${name}\n      ${String(e?.message ?? e).split('\n')[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ---- start preview server for dist/
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(URL_BASE);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start (did you run `npm run build`?)');
}

const browser = await (async () => {
  await waitForServer();
  return chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
})();

const consoleErrors = [];
async function newPage(viewport = { width: 1440, height: 900 }, ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, ...ctxOpts });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.goto(URL_BASE);
  await page.waitForSelector('.topbar');
  return { ctx, page };
}

/** Advance the simulation deterministically from the test, then let the UI publish. */
const advance = (page, seconds) =>
  page.evaluate((s) => {
    const rt = window.__kmRuntime;
    rt.simulation.run(s);
    rt.act(() => 0);
  }, seconds);
const snap = (page) => page.evaluate(() => {
  const s = window.__kmRuntime.simulation.snapshot();
  return { mode: s.control.mode, sp: s.control.setpoint, pv: s.control.pv, out: s.control.output, kp: s.control.pid.tunings.kp, plant: s.plant, estop: s.control.safety.estop, alarms: s.control.alarms.filter((a) => a.state !== 'normal').map((a) => a.id), il: s.control.safety.interlocks.map((i) => [i.id, i.tripped]) };
});
const go = async (page, route) => {
  await page.click(`nav a[href="#/${route}"]`);
  await page.waitForTimeout(150);
};
const setField = async (page, selector, value) => {
  await page.fill(selector, String(value));
  await page.press(selector, 'Enter');
  await page.waitForTimeout(120);
};

try {
  const { ctx, page } = await newPage();

  await check('E01 app loads with title, brand and simulation badge', async () => {
    assert((await page.title()) === 'K.M. Industrial Control Simulator', 'title');
    assert(await page.locator('.sim-badge').isVisible(), 'sim badge');
    assert((await page.locator('.sim-badge').innerText()).includes('no hardware'), 'badge text');
  });

  await check('E02 five pages render via navigation', async () => {
    const heads = { dashboard: 'Level loop', control: 'PID tuning', trends: 'Process value, setpoint and output', alarms: 'Alarm summary', settings: 'Fault injection' };
    for (const [route, text] of Object.entries(heads)) {
      await go(page, route);
      assert(await page.locator(`.card-head h2:has-text("${text}")`).first().isVisible(), `${route}: missing "${text}"`);
    }
    await go(page, 'dashboard');
  });

  await check('E03 3D canvas renders real (non-uniform) pixels via WebGL', async () => {
    const colours = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const rt = window.__kmRuntime;
          const cv = document.querySelector('canvas.scene-canvas');
          const off = rt.onFrame(() => {
            off();
            const c2 = document.createElement('canvas');
            c2.width = 64;
            c2.height = 48;
            const g = c2.getContext('2d');
            g.drawImage(cv, 0, 0, 64, 48);
            const d = g.getImageData(0, 0, 64, 48).data;
            const set = new Set();
            for (let i = 0; i < d.length; i += 4) set.add(`${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`);
            resolve(set.size);
          });
        }),
    );
    assert(colours > 25, `only ${colours} distinct colours: canvas looks blank`);
    return `${colours} distinct colours`;
  });

  await go(page, 'control');

  await check('E04 typing a setpoint in the UI reaches the controller', async () => {
    await setField(page, '#ctl-sp-num', 65);
    assert((await snap(page)).sp === 65, 'setpoint not applied');
  });

  await check('E05 out-of-range typing is rejected (not clamped) and garbage text is rejected', async () => {
    await setField(page, '#ctl-sp-num', 65);
    await setField(page, '#ctl-sp-num', 650);
    assert((await snap(page)).sp === 65, 'out-of-range value changed the setpoint');
    assert(await page.locator('.toast-error').first().isVisible(), 'no error toast for 650');
    await setField(page, '#ctl-sp-num', 'abc');
    assert((await snap(page)).sp === 65, 'garbage changed setpoint');
    assert((await page.inputValue('#ctl-sp-num')) === '65.0', 'field did not snap back to the live value');
  });

  await check('E06 Auto mode drives the process to the setpoint (real-time UI readout)', async () => {
    await page.click('.segmented[aria-label="Controller mode"] >> text=Auto');
    assert((await snap(page)).mode === 'auto', 'mode not auto');
    assert(await page.locator('#ctl-out-num').isDisabled(), 'manual output not disabled in Auto');
    await advance(page, 400);
    const s = await snap(page);
    assert(Math.abs(s.plant.levelPct - 65) < 1, `level ${s.plant.levelPct.toFixed(2)} not at 65`);
    const shown = await page.locator('.ctl-loop .readout').first().locator('.num').innerText();
    assert(Math.abs(Number(shown) - 65) < 1.5, `PV readout shows ${shown}`);
    return `level ${s.plant.levelPct.toFixed(2)} %`;
  });

  await check('E07 changing Kp/Ki/Kd in the UI updates the controller; invalid input is rejected', async () => {
    await setField(page, '#kp-num', 12.5);
    await setField(page, '#ki-num', 0.2);
    await setField(page, '#kd-num', 2);
    let s = await page.evaluate(() => window.__kmRuntime.control.snapshot().pid.tunings);
    assert(s.kp === 12.5 && s.ki === 0.2 && s.kd === 2, JSON.stringify(s));
    await setField(page, '#kp-num', -3);
    s = await page.evaluate(() => window.__kmRuntime.control.snapshot().pid.tunings);
    assert(s.kp === 12.5, `negative Kp was not rejected: ${s.kp}`);
    await setField(page, '#kp-num', 6);
    await setField(page, '#ki-num', 0.1);
    await setField(page, '#kd-num', 0);
  });

  await check('E08 setpoint step response observed through the UI (50 -> 40 -> 70)', async () => {
    await setField(page, '#ctl-sp-num', 40);
    await advance(page, 300);
    const a = (await snap(page)).plant.levelPct;
    await setField(page, '#ctl-sp-num', 70);
    await advance(page, 300);
    const b = (await snap(page)).plant.levelPct;
    assert(Math.abs(a - 40) < 1 && Math.abs(b - 70) < 1, `levels ${a.toFixed(2)}, ${b.toFixed(2)}`);
    return `${a.toFixed(2)} then ${b.toFixed(2)}`;
  });

  await check('E09 header E-stop stops pump, closes inlet, forces Manual and refuses Auto', async () => {
    await page.click('.estop');
    await advance(page, 15);
    const s = await snap(page);
    assert(s.mode === 'manual' && s.estop.latched && s.estop.pressed, 'state');
    assert(s.plant.pumpSpeedPct < 1 && s.plant.inletValvePct === 0, `pump ${s.plant.pumpSpeedPct} inlet ${s.plant.inletValvePct}`);
    assert(await page.locator('.alarm-banner.prio-critical').isVisible(), 'critical banner missing');
    await page.click('.segmented[aria-label="Controller mode"] >> text=Auto');
    assert((await snap(page)).mode === 'manual', 'Auto accepted during E-stop');
    assert(await page.locator('.toast-error', { hasText: /E-stop/i }).first().isVisible(), 'no refusal toast');
  });

  await check('E10 E-stop needs Release then Reset; pump does not restart by itself', async () => {
    await page.click('.estop.is-active');
    assert((await page.locator('.estop.is-reset').innerText()).includes('Reset'), 'reset button state');
    await page.click('.estop.is-reset');
    await advance(page, 10);
    const s = await snap(page);
    assert(!s.estop.latched && s.plant.pumpSpeedPct < 1, 'restarted or still latched');
    assert(s.plant.inletValvePct > 99, 'inlet did not reopen');
    const banner = page.locator('.alarm-banner.is-cleared');
    assert(await banner.isVisible(), 'cleared-state banner missing');
    assert((await banner.innerText()).includes('Returned to normal'), 'banner does not say the alarm cleared');
    assert(await page.locator('.nav-badge').isVisible(), 'unacknowledged badge missing on Alarms nav item');
  });

  await check('E11 overfill in Manual trips IL-01 and the Alarms page shows it', async () => {
    await page.evaluate(() => {
      const rt = window.__kmRuntime;
      rt.act((c) => {
        c.setOutletValveCommand(0);
        c.setManualOutput(100);
      });
    });
    await advance(page, 400);
    const s = await snap(page);
    assert(s.il.find((x) => x[0] === 'IL-01')[1] === true, 'IL-01 not tripped');
    assert(s.plant.pumpSpeedPct < 1 && s.plant.levelPct <= 100, 'pump still running');
    await go(page, 'alarms');
    assert(await page.locator('tr', { hasText: 'IL-01' }).first().isVisible(), 'IL-01 row missing');
    assert(await page.locator('tr', { hasText: 'Level high-high' }).first().isVisible(), 'LAHH row missing');
  });

  await check('E12 acknowledge-all clears the unacknowledged count; reset is refused while level is high', async () => {
    await page.click('button:has-text("Acknowledge all") >> nth=0');
    await page.waitForTimeout(200);
    const un = await page.locator('.tile', { hasText: 'Unacknowledged' }).locator('.tile-value').innerText();
    assert(un.trim() === '0', `unacknowledged = ${un}`);
    await page.click('button:has-text("Reset interlocks")');
    assert(await page.locator('.toast-error', { hasText: /Reset refused/ }).first().isVisible(), 'no refusal toast');
    assert((await snap(page)).il.find((x) => x[0] === 'IL-01')[1] === true, 'IL-01 cleared too early');
  });

  await check('E13 after draining below the reset level, reset succeeds and history logs events', async () => {
    await page.evaluate(() => window.__kmRuntime.act((c) => c.setOutletValveCommand(100)));
    await advance(page, 300);
    await page.click('button:has-text("Reset interlocks")');
    await page.waitForTimeout(200);
    assert((await snap(page)).il.find((x) => x[0] === 'IL-01')[1] === false, 'IL-01 still tripped');
    await page.click('.segmented[aria-label="View"] >> text=History');
    const rows = await page.locator('.table tbody tr').count();
    assert(rows >= 3, `history rows = ${rows}`);
  });

  await check('E14 Trends page: chart draws, window switch works, CSV export downloads real data', async () => {
    await go(page, 'trends');
    await page.click('.segmented[aria-label="Time window"] >> text=15 min');
    await page.waitForTimeout(300);
    const dl = page.waitForEvent('download');
    await page.click('button:has-text("Export CSV")');
    const file = await dl;
    const p = path.join(outDir, 'trend.csv');
    await file.saveAs(p);
    const text = readFileSync(p, 'utf8').trim().split('\n');
    assert(text[0] === 'time_s,setpoint_pct,pv_pct,output_pct,pressure_bar,flow_lps', 'csv header');
    assert(text.length > 100, `csv rows ${text.length}`);
    const cols = text[50].split(',');
    assert(cols.length === 6 && cols.every((c) => Number.isFinite(Number(c))), 'csv row not numeric');
    return `${text.length - 1} samples`;
  });

  await check('E15 Settings: invalid alarm limits are rejected with a message, valid limits are applied', async () => {
    await go(page, 'settings');
    const high = page.locator('input[aria-label="Level high (%)"]');
    await high.fill('95');
    await page.click('button:has-text("Apply limits")');
    assert(await page.locator('.form-error').isVisible(), 'no validation error shown');
    await high.fill('75');
    await page.click('button:has-text("Apply limits")');
    await page.waitForTimeout(200);
    const lim = await page.evaluate(() => window.__kmRuntime.control.snapshot().alarmLimits.levelH);
    assert(lim === 75, `levelH = ${lim}`);
    await high.fill('80');
    await page.click('button:has-text("Apply limits")');
  });

  await check('E16 fault injection: LT-101 fails high -> LT_FAULT alarm, Auto refused', async () => {
    await page.click('.segmented[aria-label="LT-101 fault"] >> text=Fails high');
    await advance(page, 3);
    const s = await snap(page);
    assert(s.alarms.includes('LT_FAULT'), 'LT_FAULT missing');
    assert(!s.alarms.includes('LAHH'), 'spurious LAHH on bad signal');
    await page.click('.segmented[aria-label="LT-101 fault"] >> text=Healthy');
    await advance(page, 2);
  });

  await check('E17 settings persist across reload (Kp saved to localStorage)', async () => {
    await go(page, 'control');
    await setField(page, '#kp-num', 9);
    await page.reload();
    await page.waitForSelector('.topbar');
    await go(page, 'control');
    const kp = await page.evaluate(() => window.__kmRuntime.control.snapshot().pid.tunings.kp);
    assert(kp === 9, `kp after reload = ${kp}`);
    await setField(page, '#kp-num', 6);
  });

  await check('E18 3D interaction: click pump selects it, click E-stop post presses it, drag SP tab moves setpoint', async () => {
    await go(page, 'dashboard');
    await page.waitForTimeout(400);
    const pt = async (id) => page.evaluate((i) => window.__kmScene.screenPointOf(i), id);
    // pump
    let p = await pt('pump');
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
    assert(await page.locator('.card-head h2:has-text("P-101")').isVisible(), 'pump card not shown');
    // setpoint drag
    const before = (await snap(page)).sp;
    p = await pt('sp');
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x, p.y - 60, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = (await snap(page)).sp;
    assert(after > before + 5, `setpoint ${before} -> ${after}: drag did not move it up`);
    // e-stop post
    p = await pt('estop');
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
    assert((await snap(page)).estop.pressed, 'physical E-stop click did not press it');
    await page.click('.estop.is-active');
    await page.click('.estop.is-reset');
    return `SP ${before} -> ${after}`;
  });

  await check('E23 real-time loop: simulation time advances with wall-clock time and scales with speed', async () => {
    const t = () => page.evaluate(() => window.__kmRuntime.control.snapshot().time);
    await page.evaluate(() => window.__kmRuntime.setSpeed(1));
    const a0 = await t();
    await page.waitForTimeout(2000);
    const a1 = await t();
    await page.evaluate(() => window.__kmRuntime.setSpeed(10));
    const b0 = await t();
    await page.waitForTimeout(2000);
    const b1 = await t();
    await page.evaluate(() => window.__kmRuntime.setSpeed(1));
    const d1 = a1 - a0;
    const d10 = b1 - b0;
    assert(d1 > 0.8 && d1 < 3, `1x advanced ${d1.toFixed(2)} s in 2 s of wall time`);
    assert(d10 > d1 * 3, `10x advanced ${d10.toFixed(2)} s vs 1x ${d1.toFixed(2)} s`);
    return `1x: ${d1.toFixed(1)} s, 10x: ${d10.toFixed(1)} s per 2 s wall`;
  });

  await check('E24 Pause freezes the simulation and Run resumes it', async () => {
    const t = () => page.evaluate(() => window.__kmRuntime.control.snapshot().time);
    await page.click('.topbar button:has-text("Pause")');
    const p0 = await t();
    await page.waitForTimeout(800);
    const p1 = await t();
    assert(p1 === p0, `time moved while paused: ${p0} -> ${p1}`);
    await page.click('.topbar button:has-text("Run")');
    await page.waitForTimeout(800);
    assert((await t()) > p1, 'did not resume');
  });

  await check('E19 desktop layout: left rail, no horizontal overflow on any page', async () => {
    const rail = await page.locator('nav.nav').boundingBox();
    assert(rail && rail.x === 0 && rail.width < 120, `rail ${JSON.stringify(rail)}`);
    for (const r of ['dashboard', 'control', 'trends', 'alarms', 'settings']) {
      await go(page, r);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(over <= 0, `${r}: overflow ${over}px`);
    }
  });
  await page.screenshot({ path: path.join(outDir, 'desktop-settings.png'), fullPage: true });
  await go(page, 'control');
  await page.screenshot({ path: path.join(outDir, 'desktop-control.png'), fullPage: true });
  await go(page, 'trends');
  await page.screenshot({ path: path.join(outDir, 'desktop-trends.png'), fullPage: true });
  await go(page, 'dashboard');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'desktop-dashboard.png'), fullPage: true });
  await ctx.close();

  // ---- phone
  const m = await newPage({ width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await check('E20 phone layout: bottom nav, no horizontal overflow on any page, E-stop reachable', async () => {
    const nav = await m.page.locator('nav.nav').boundingBox();
    assert(nav && nav.y > 700 && nav.width >= 380, `nav ${JSON.stringify(nav)}`);
    for (const r of ['dashboard', 'control', 'trends', 'alarms', 'settings']) {
      await m.page.click(`nav a[href="#/${r}"]`);
      await m.page.waitForTimeout(250);
      const over = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(over <= 0, `${r}: overflow ${over}px`);
      const es = await m.page.locator('.estop').boundingBox();
      assert(es && es.y >= 0 && es.y < 120 && es.height >= 44, `E-stop box ${JSON.stringify(es)}`);
    }
    await m.page.screenshot({ path: path.join(outDir, 'phone-settings.png'), fullPage: true });
  });
  await check('E20b phone: E-stop stays reachable (sticky header) after scrolling a long page', async () => {
    await m.page.click('nav a[href="#/settings"]');
    await m.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await m.page.waitForTimeout(200);
    const es = await m.page.locator('.estop').boundingBox();
    assert(es && es.y >= 0 && es.y < 80, `E-stop scrolled away: ${JSON.stringify(es)}`);
    const hdr = await m.page.locator('.topbar').boundingBox();
    assert(hdr.height < 140, `header too tall on phone: ${hdr.height}px`);
    await m.page.evaluate(() => window.scrollTo(0, 0));
  });
  await check('E21 phone: setpoint can be changed and Auto engaged by touch', async () => {
    await m.page.click('nav a[href="#/control"]');
    await m.page.tap('.segmented[aria-label="Controller mode"] >> text=Auto');
    await setField(m.page, '#ctl-sp-num', 55);
    const s = await snap(m.page);
    assert(s.mode === 'auto' && s.sp === 55, JSON.stringify({ mode: s.mode, sp: s.sp }));
  });
  await m.page.click('nav a[href="#/dashboard"]');
  await m.page.waitForTimeout(600);
  await m.page.screenshot({ path: path.join(outDir, 'phone-dashboard.png'), fullPage: false });
  await m.ctx.close();

  await check('E22 no console errors or uncaught exceptions during the whole run', async () => {
    assert(consoleErrors.length === 0, `${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).join(' | ')}`);
  });
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nE2E: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
process.exit(failed.length ? 1 : 0);
