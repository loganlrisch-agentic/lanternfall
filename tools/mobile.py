# Phone-size screenshots of the main screens, with touch emulation.
# Usage: python3 tools/mobile.py OUT_PREFIX WIDTH HEIGHT [screens]
# screens: comma list of title,heroes,camp,battle,story (default all)
import asyncio, sys, json, time
from playwright.async_api import async_playwright

prefix, W, H = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
which = (sys.argv[4] if len(sys.argv) > 4 else 'title,heroes,camp,battle').split(',')
BASE = 'http://127.0.0.1:8124/index.html'
SAVE = {"v":1,"hero":"knight","difficulty":"normal","chapter":3,"level":4,"xp":20,"valor":3,"talents":{},"gold":900,"flags":{"spareCursed":True},"unitLevels":{},"upgrades":{},"loadout":["militia","footman","archer","bannerman","shieldbearer","cleric"],"seenUnlocks":[],"stats":{"kills":150,"battles":2,"lost":9},"created":0}

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        logs = []
        pg.on('pageerror', lambda e: logs.append('pageerror ' + str(e)[:200]))
        pg.on('console', lambda m: m.type == 'error' and logs.append('console ' + m.text[:200]))
        js = pg.evaluate
        async def wait_for(expr, t=240):
            t0 = time.time()
            while not await js(expr):
                if time.time() - t0 > t: return False
                await asyncio.sleep(0.5)
            return True
        if 'battle' in which:
            await pg.goto(BASE + '?test=battle&ch=2&sim=50&auto=1')
            await wait_for('window.__ready === true')
            print('touch class:', await js("document.getElementById('hud').classList.contains('touch')"), 'coarse:', await js("matchMedia('(pointer: coarse)').matches"))
            await pg.screenshot(path=f'{prefix}_battle.jpg', timeout=120000)
        if 'story' in which:
            await pg.goto(BASE + '?test=battle&ch=1&story=1')
            await wait_for('window.__ready === true')
            await asyncio.sleep(4)
            await pg.screenshot(path=f'{prefix}_story.jpg', timeout=120000)
            # jump to the first choice in the chapter 1 outro
            await js("(() => { const g = window.__game, s = g.story; s.run(g.battle, (window.__outro || []), {}); })()")
        if 'pause' in which:
            await pg.goto(BASE + '?test=battle&ch=1&sim=5&auto=0')
            await wait_for('window.__ready === true')
            await js("(() => { const g = window.__game; g.testMode = false; g.testStep = null; g.pause(); })()")
            await asyncio.sleep(1.5)
            await pg.screenshot(path=f'{prefix}_pause.jpg', timeout=120000)
        if set(which) & {'title', 'heroes', 'camp', 'sheet'}:
            await pg.goto(BASE)
            await js(f"localStorage.setItem('lanternfall_save_v1', JSON.stringify({json.dumps(SAVE)}))")
            await pg.goto(BASE)
            await wait_for("!!document.querySelector('.title-screen.on')")
            await asyncio.sleep(1.5)
            if 'title' in which: await pg.screenshot(path=f'{prefix}_title.jpg', timeout=120000)
            if 'heroes' in which:
                await js("document.querySelector('button[data-a=\"new\"]').click()")
                await asyncio.sleep(1.2)
                # confirm overwrite if asked
                await js("(() => { const b = document.querySelector('.modal button.primary, .confirm button.primary'); if (b) b.click(); })()")
                await asyncio.sleep(1.5)
                await pg.screenshot(path=f'{prefix}_heroes.jpg', timeout=120000)
                await pg.goto(BASE); await wait_for("!!document.querySelector('.title-screen.on')"); await asyncio.sleep(1)
            if 'camp' in which:
                await js("document.querySelector('button[data-a=\"continue\"]').click()")
                await wait_for("!!document.querySelector('.camp.on, .screen.camp.on')", 30)
                await asyncio.sleep(1.5)
                await pg.screenshot(path=f'{prefix}_camp.jpg', timeout=120000)
            if 'sheet' in which:
                if 'camp' not in which:
                    await js("document.querySelector('button[data-a=\"continue\"]').click()")
                    await wait_for("!!document.querySelector('.camp-screen.on')", 30)
                    await asyncio.sleep(1)
                await pg.tap('.ucard[data-u="archer"]')
                await asyncio.sleep(0.8)
                await pg.screenshot(path=f'{prefix}_sheet.jpg', timeout=120000)
                print('sheet visible:', await js("(() => { const a = document.querySelector('.muster.has-sel aside'); return !!a && getComputedStyle(a).display !== 'none'; })()"))
                await pg.tap('[data-load="archer"]'); await asyncio.sleep(0.5)
                print('loadout after toggle:', await js("JSON.parse(localStorage.getItem('lanternfall_save_v1')).loadout"))
                await pg.tap('.sheet-close'); await asyncio.sleep(0.5)
                print('sheet closed:', await js("!document.querySelector('.muster.has-sel')"))
        for l in logs[:8]: print(l)
        await b.close()

asyncio.run(main())
