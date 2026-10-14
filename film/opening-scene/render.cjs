#!/usr/bin/env node
/*
 * يصيّر المشهد إطارًا إطارًا في Chromium (Playwright) ويرسل الإطارات إلى ffmpeg.
 *
 *   node render.cjs --out ../build            → فيديو بالترجمة + فيديو نظيف + timeline.json
 *   node render.cjs --stills 12,60,130,200    → صور ثابتة للمراجعة فقط
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = __dirname;
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const OUT = path.resolve(opt('--out', path.join(ROOT, '..', 'build')));
const STILLS = opt('--stills', null);
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.ttf': 'font/ttf' };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
function encoder(file) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '24', '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '24', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c)))));
  const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));
  return { write, end: () => { ff.stdin.end(); return done; } };
}

(async () => {
  const srv = await serve();
  const url = `http://127.0.0.1:${srv.address().port}/index.html?render=1`;
  const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--force-color-profile=srgb'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.sceneReady || window.sceneError, null, { timeout: 60000 });
  const err = await page.evaluate(() => window.sceneError);
  if (err) throw new Error(err);
  const clip = { x: 0, y: 0, width: 1920, height: 1080 };
  const FRAMES = await page.evaluate(() => window.SCENE.FRAMES);

  if (STILLS) {
    for (const f of STILLS.split(',').map(Number)) {
      await page.evaluate((i) => window.SCENE.renderFrame(i, { subs: true }), f);
      await page.screenshot({ path: path.join(OUT, `still_${String(f).padStart(3, '0')}.png`), clip });
      console.log('still', f);
    }
  } else {
    fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(await page.evaluate(() => window.SCENE.timeline()), null, 1));
    const clean = encoder(path.join(OUT, 'video_clean.mp4'));
    const subs = encoder(path.join(OUT, 'video_subs.mp4'));
    const t0 = Date.now();
    for (let i = 0; i < FRAMES; i++) {
      await page.evaluate((f) => window.SCENE.renderFrame(f, { subs: false }), i);
      await clean.write(await page.screenshot({ type: 'png', clip }));
      await page.evaluate((f) => window.SCENE.renderSubs(f), i);
      await subs.write(await page.screenshot({ type: 'png', clip }));
      if (i % 24 === 0) console.log(`frame ${i}/${FRAMES}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
    await Promise.all([clean.end(), subs.end()]);
    console.log('done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  }
  await browser.close();
  srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
