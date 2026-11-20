# Renders a batch of ally units standing together, for checking models, weapons and tints.
# Usage: python3 tools/gallery.py OUT.jpg id1,id2,...(up to 8)
import asyncio, sys, time
from playwright.async_api import async_playwright

out, ids = sys.argv[1], sys.argv[2]
url = f"http://127.0.0.1:8124/index.html?test=battle&ch=1&sim=1&auto=0&loadout={ids}"
JS = r"""
() => {
  const g = window.__game, b = g.battle;
  b.coins = 999; b.popCap = 99;
  const step = (n) => { for (let i = 0; i < n; i++) { b.update(1 / 30, g.input.empty); g.world.update(1 / 30); } };
  b.cards.forEach((c, i) => { c.cd = 0; b.summon(i); });
  step(150);
  // line them up side by side, facing the camera, out of formation
  const us = b.army.units.slice();
  const names = [];
  us.forEach((u, i) => { u.army = null; u.desired = 0; u.place(-50, -9 + i * (18 / Math.max(1, us.length - 1)), 0); u.facing = 0; names.push(u.def.name); });
  for (let i = 0; i < 8; i++) { for (const u of us) { u.facing = 0; u.desired = 0; } b.update(1 / 60, g.input.empty); }
  const look = { x: -50, y: b.h(-50, 0) + 1.2, z: 0 };
  const cam = g.world.camera;
  b.cam.hold(new cam.position.constructor(-38, look.y + 3.5, 0.5), new cam.position.constructor(look.x, look.y, look.z));
  b.cam.update(1 / 60, null, b.hero);
  g.R.render(1 / 60);
  return names;
}
"""

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await br.new_page(viewport={'width': 1280, 'height': 560})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        await pg.goto(url)
        t0 = time.time()
        while not await pg.evaluate('window.__ready === true'):
            if time.time() - t0 > 240: break
            await asyncio.sleep(1)
        names = await pg.evaluate(JS)
        await pg.screenshot(path=out, timeout=120000)
        print(out, names)
        for e in errs[:5]: print('pageerror', e)
        await br.close()

asyncio.run(main())
