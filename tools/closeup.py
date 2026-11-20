# Close-up render of a unit for checking models, weapons and animations.
# Usage: python3 tools/closeup.py OUT.jpg CARD_INDEX [extra url params]
# Calls in the unit on the given card, lets the battle run a few seconds so it
# fights, then frames the camera on it from the side and renders a few frames.
import asyncio, sys, json, time
from playwright.async_api import async_playwright

out, card = sys.argv[1], int(sys.argv[2])
extra = sys.argv[3] if len(sys.argv) > 3 else ''
url = f"http://127.0.0.1:8124/index.html?test=battle&ch=1&sim=1&auto=0{extra}"

JS = r"""
async ([card, side, settle]) => {
  const g = window.__game, b = g.battle;
  const step = (n, dt) => { for (let i = 0; i < n; i++) { b.update(dt, g.input.empty); g.world.update(dt); } };
  if (!window.__closeU) {
    b.coins = 99;
    if (card >= 0) { b.cards[card].cd = 0; b.summon(card); }
    step(Math.round(settle * 30), 1 / 30);
    window.__closeU = card >= 0 ? b.army.units[0] : b.hero;
  }
  const u = window.__closeU;
  step(side.frames, 1 / 30);
  const T = g.world.camera.constructor;  // unused, keeps bundle names out of the way
  const p = u.pos.clone(), f = u.facing;
  // camera to the unit's side (perpendicular to its facing), slightly above
  const sx = Math.cos(f) * side.k, sz = -Math.sin(f) * side.k;
  const cam = p.clone(); cam.x += sx * 4.2; cam.z += sz * 4.2; cam.y += 1.9;
  const look = p.clone(); look.y += 1.0;
  b.cam.hold(cam, look);
  b.update(1 / 60, g.input.empty); g.world.update(1 / 60);
  g.R.render(1 / 60);
  return { anim: u.animator && u.animator.shot ? 'shot' : 'loop', target: !!u.target, x: u.pos.x.toFixed(1), facing: f.toFixed(2), name: u.def.name };
}
"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 900, 'height': 600})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(url)
        t0 = time.time()
        while not await pg.evaluate('window.__ready === true'):
            if time.time() - t0 > 200: break
            await asyncio.sleep(1)
        shots = [(+1, 0, 26), (+1, 7, 0), (-1, 5, 0)]
        for i, (k, frames, settle) in enumerate(shots):
            info = await pg.evaluate(JS, [card, {'k': k, 'frames': frames}, settle])
            o = out.replace('.jpg', f'_{i}.jpg')
            await pg.screenshot(path=o, timeout=120000)
            print(o, json.dumps(info))
        for e in errs[:5]: print('pageerror', e[:300])
        await b.close()

asyncio.run(main())
