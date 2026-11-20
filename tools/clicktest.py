# Real mouse clicks on the battlefield: ground click -> move order, enemy click -> target.
import asyncio, json, time
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8124/index.html?test=battle&ch=1&sim=45&auto=0"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL)
        t0 = time.time()
        while not await pg.evaluate('window.__ready === true'):
            if time.time() - t0 > 240: break
            await asyncio.sleep(1)
        js = pg.evaluate
        step = "(() => { const g = window.__game; g.battle.update(1/60, g.input.frame()); })()"
        print('element at click point:', await js("(() => { const e = document.elementFromPoint(900, 300); return e && (e.id || e.className || e.tagName); })()"))
        print('input enabled:', await js('window.__game.input.enabled'))
        await pg.mouse.click(900, 300)
        await js(step)
        print('ground click -> moveTo:', await js("(() => { const h = window.__game.battle.hero; return h.moveTo ? [+h.moveTo.x.toFixed(1), +h.moveTo.z.toFixed(1)] : null; })()"),
              'hero at', await js("(() => { const h = window.__game.battle.hero; return [+h.pos.x.toFixed(1), +h.pos.z.toFixed(1)]; })()"))
        # bring an enemy close and click on it
        pos = await js("""(() => {
          const g = window.__game, b = g.battle, h = b.hero;
          let e = b.units.find(u => u.team === 1 && u.alive);
          if (!e) return null;
          e.place(h.pos.x + 7, h.pos.z - 2, -Math.PI / 2);
          for (let i = 0; i < 3; i++) b.update(1/60, g.input.empty);
          g.R.render(1/60);
          const s = b.cam.toScreen(e.pos.clone().setY(e.pos.y + 1.2), innerWidth, innerHeight);
          window.__clickE = e;
          return [s.x, s.y, e.def.name];
        })()""")
        print('enemy on screen at', pos)
        if pos:
            await pg.mouse.click(pos[0], pos[1])
            await js(step)
            print('enemy click -> target:', await js("(() => { const t = window.__game.battle.hero.target; return t ? [t.def.name, t === window.__clickE] : null; })()"))
            # a few seconds later the hero should be fighting it
            await js("(() => { const g = window.__game; for (let i = 0; i < 120; i++) g.battle.update(1/60, g.input.empty); })()")
            print('after 2s: target hp', await js("(() => { const e = window.__clickE; return [Math.round(e.hp), Math.round(e.maxHp), e.alive]; })()"),
                  'dist', await js("(() => { const h = window.__game.battle.hero, e = window.__clickE; return +h.pos.distanceTo(e.pos).toFixed(1); })()"))
        # spells pick their own targets
        print('cast Q:', await js("(() => { const g = window.__game, h = g.battle.hero; h.cooldowns[h.cls.abilities[0]] = 0; g.input.edge('KeyQ'); g.battle.update(1/60, g.input.frame()); return h.cooldowns[h.cls.abilities[0]] > 0; })()"))
        for e in errs[:5]: print('pageerror', e[:300])
        await b.close()

asyncio.run(main())
