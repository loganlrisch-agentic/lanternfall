# Arcade screens at a given size: setup, after picks, the battle start, and a sample results screen.
# Usage: python3 tools/arcade.py OUT_PREFIX WIDTH HEIGHT [mobile]
import asyncio, sys, time
from playwright.async_api import async_playwright

prefix, W, H = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
mobile = len(sys.argv) > 4
BASE = 'http://127.0.0.1:8124/index.html'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
        pg = await ctx.new_page()
        logs = []
        pg.on('pageerror', lambda e: logs.append('pageerror ' + str(e)[:300]))
        pg.on('console', lambda m: m.type == 'error' and logs.append('console ' + m.text[:300]))
        js = pg.evaluate
        async def wait_for(expr, t=300):
            t0 = time.time()
            while not await js(expr):
                if time.time() - t0 > t: return False
                await asyncio.sleep(0.5)
            return True
        await pg.goto(BASE)
        await js("localStorage.removeItem('lanternfall_arcade_v1')")
        await pg.goto(BASE)
        await wait_for("!!document.querySelector('.title-screen.on')")
        await asyncio.sleep(1.2)
        await pg.screenshot(path=f'{prefix}_title.jpg', timeout=120000)
        await js("document.querySelector('[data-a=arcade]').click()")
        await wait_for("!!document.querySelector('.arcade-screen.on')")
        await asyncio.sleep(1.0)
        await pg.screenshot(path=f'{prefix}_setup.jpg', timeout=120000)
        # remove two, filter to giants, add one, tap a foe
        await js("document.querySelectorAll('.arcade-screen .slot[data-rm]')[0].click()")
        await js("document.querySelector('[data-filter=heavy]').click()")
        await asyncio.sleep(0.3)
        await js("document.querySelector('.arc-roster .ucard:not(.in)').click()")
        await js("document.querySelector('[data-n=\"3\"]').click()")
        await asyncio.sleep(0.3)
        await js("document.querySelector('.arc-foe:nth-child(5)').click()")
        await asyncio.sleep(0.5)
        await pg.screenshot(path=f'{prefix}_picked.jpg', timeout=120000)
        await js("document.querySelector('[data-filter=all]').click()")
        await js("document.querySelector('[data-a=random]').click()")
        await asyncio.sleep(0.3)
        state = await js("JSON.parse(localStorage.getItem('lanternfall_arcade_v1')).last")
        print('saved setup:', state)
        if mobile:
            await js("document.querySelector('.arcade-screen').scrollTop = 99999")
            await asyncio.sleep(0.4)
            await pg.screenshot(path=f'{prefix}_scrolled.jpg', timeout=120000)
        await js("document.querySelector('[data-a=go]').click()")
        ok = await wait_for("!!(window.__game && window.__game.battle && window.__game.battle.state === 'fight')", 120)
        await asyncio.sleep(2.5)
        print('battle started:', ok, await js("(() => { const b = window.__game.battle; return { cards: b.cards.map(c => c.def.id), lvl: b.hero.level, night: b.chapter.n, arcade: !!window.__game.arcade }; })()"))
        await pg.screenshot(path=f'{prefix}_battle.jpg', timeout=120000)
        # pause menu wording
        await js("window.__game.pause()")
        await asyncio.sleep(1.0)
        await pg.screenshot(path=f'{prefix}_pause.jpg', timeout=120000)
        # end the battle as a win to see the results screen
        await js("(() => { const g = window.__game; g.resume(); g.battle.stats.kills = 212; g.battle.stats.xp = 2400; g.battle.stats.time = 694; g.battle.castle.hp = g.battle.castle.maxHp * 0.82; g.onBattleEnd(true, g.battle); })()")
        await wait_for("!!document.querySelector('.arcade-results.on')", 30)
        await asyncio.sleep(1.0)
        await pg.screenshot(path=f'{prefix}_results.jpg', timeout=120000)
        print('best:', await js("JSON.parse(localStorage.getItem('lanternfall_arcade_v1')).best"))
        await js("document.querySelector('.arcade-results [data-a=troops]').click()")
        ok2 = await wait_for("!!document.querySelector('.arcade-screen.on')", 30)
        print('back to troops:', ok2, 'best shown:', await js("document.querySelector('.arc-night.sel small').textContent"))
        print('\n'.join(logs[:12]) or 'no errors')
        await b.close()
asyncio.run(main())
