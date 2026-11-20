# Touch input on a phone-sized screen: tap -> move, tap enemy -> target, pinch -> zoom (no move),
# spell and card buttons by tap. Usage: python3 tools/touchtest.py [W H]
import asyncio, sys, time
from playwright.async_api import async_playwright

W = int(sys.argv[1]) if len(sys.argv) > 1 else 390
H = int(sys.argv[2]) if len(sys.argv) > 2 else 844
URL = "http://127.0.0.1:8124/index.html?test=battle&ch=1&sim=45&auto=0"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': W, 'height': H}, is_mobile=True, has_touch=True, device_scale_factor=1)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL)
        t0 = time.time()
        while not await pg.evaluate('window.__ready === true'):
            if time.time() - t0 > 240: break
            await asyncio.sleep(1)
        js = pg.evaluate
        step = "(() => { const g = window.__game; g.battle.update(1/60, g.input.frame()); })()"
        hero = "(() => { const h = window.__game.battle.hero; return { moveTo: h.moveTo ? [+h.moveTo.x.toFixed(1), +h.moveTo.z.toFixed(1)] : null, target: h.target ? (h.target.def ? h.target.def.name : 'rift') : null, pos: [+h.pos.x.toFixed(1), +h.pos.z.toFixed(1)] }; })()"
        print('portrait camera:', await js('window.__game.battle.cam.portrait'), 'fov', await js('window.__game.world.camera.fov.toFixed(1)'))
        # 1) tap the ground above the hero (toward the fog in portrait)
        await pg.touchscreen.tap(W * 0.5, H * 0.35)
        await js(step)
        print('tap ground ->', await js(hero))
        # 2) tap an enemy
        pos = await js("""(() => {
          const g = window.__game, b = g.battle, h = b.hero;
          const e = b.units.find(u => u.team === 1 && u.alive); if (!e) return null;
          e.place(h.pos.x + 7, h.pos.z + 1, -Math.PI / 2);
          for (let i = 0; i < 3; i++) b.update(1/60, g.input.empty);
          const s = b.cam.toScreen(e.pos.clone().setY(e.pos.y + 1.2), innerWidth, innerHeight);
          window.__tapE = e; return [s.x, s.y];
        })()""")
        if pos:
            await pg.touchscreen.tap(pos[0], pos[1]); await js(step)
            print('tap enemy ->', await js(hero), 'right one:', await js('window.__game.battle.hero.target === window.__tapE'))
        # 3) pinch: two synthetic touch pointers spreading apart
        d0 = await js('window.__game.battle.cam.targetDist')
        await js("""(() => {
          const c = document.getElementById('c'), r = c.getBoundingClientRect();
          const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 11 }));
          const cx = r.width / 2, cy = r.height / 2;
          ev('pointerdown', 11, cx - 20, cy); ev('pointerdown', 12, cx + 20, cy);
          for (let k = 1; k <= 10; k++) { ev('pointermove', 11, cx - 20 - k * 12, cy); ev('pointermove', 12, cx + 20 + k * 12, cy); }
          ev('pointerup', 11, cx - 140, cy); ev('pointerup', 12, cx + 140, cy);
        })()""")
        mt_before = await js("JSON.stringify(window.__game.battle.hero.moveTo)")
        await js(step)
        print('pinch apart: zoom', round(d0, 1), '->', round(await js('window.__game.battle.cam.targetDist'), 1), '| move order unchanged:', mt_before == await js("JSON.stringify(window.__game.battle.hero.moveTo)"))
        # 4) tap a unit card and a spell button
        coins0 = await js('window.__game.battle.coins = 30')
        army0 = await js('window.__game.battle.army.units.length')
        await pg.tap('.hud-card >> nth=0'); await js(step)
        print('tap card: army', army0, '->', await js('window.__game.battle.army.units.length'), 'coins', await js('Math.round(window.__game.battle.coins)'))
        await js("(() => { const h = window.__game.battle.hero; for (const k in h.cooldowns) h.cooldowns[k] = 0; })()")
        await pg.tap('.hud-ab >> nth=1'); await js(step)
        print('tap spell E: on cooldown now:', await js("(() => { const h = window.__game.battle.hero; return h.cooldowns[h.cls.abilities[1]] > 0; })()"))
        # 5) pause button
        await pg.tap('.hud-pause')
        paused = await js("window.__game.input.frame().pause")
        print('tap pause -> pause requested:', paused)
        for e in errs[:5]: print('pageerror', e[:300])
        await b.close()

asyncio.run(main())
