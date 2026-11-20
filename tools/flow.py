import asyncio, sys, json
from playwright.async_api import async_playwright
SAVE = {"v":1,"hero":"mage","difficulty":"normal","chapter":2,"level":2,"xp":20,"valor":1,"talents":{},"gold":500,"flags":{},"unitLevels":{},"upgrades":{},"loadout":["militia","footman","archer","bannerman"],"seenUnlocks":[],"stats":{"kills":50,"battles":1,"lost":5},"created":0}
def log(*a):
    print(*a, flush=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-background-networking','--disable-component-update','--no-first-run'])
        pg = await b.new_page(viewport={'width': 640, 'height': 360})
        logs = []
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') and 'GL Driver' not in m.text and '404' not in m.text else None)
        await pg.goto('http://127.0.0.1:8124/index.html?q=low')
        await pg.evaluate('s => localStorage.setItem("lanternfall_save_v1", JSON.stringify(s))', SAVE)
        await pg.reload()
        await pg.wait_for_function('document.querySelector(".title-screen.on") !== null', timeout=240000)
        js = lambda s: pg.evaluate(s)
        log('title up')
        await js('document.querySelector(\'button[data-a="continue"]\').click()')
        await pg.wait_for_timeout(3000)
        log('camp?', await js('!!document.querySelector(".camp-screen.on")'))
        await js('document.querySelector(\'button[data-a="march"]\').click()')
        await pg.wait_for_function('window.__game.story.active === true', timeout=120000)
        log('story active, battle', await js('window.__game.battle.state'))
        for i in range(40):
            await js('(() => { const s = window.__game.story; if (!s.active) return; if (s.choosing) s.pickChoice(0); else { s.skip = true; s.advance(true); } })()')
            await pg.wait_for_timeout(300)
            if not await js('window.__game.story.active'): break
        await pg.wait_for_function('window.__game.battle && window.__game.battle.state === "fight"', timeout=60000)
        log('fight started; cards', await js('window.__game.battle.cards.length'))
        # call in support and cast through the input edge system
        await js('(() => { const g = window.__game; g.battle.coins = 30; g.input.edge("Digit1"); g.input.edge("Digit2"); g.input.edge("KeyQ"); g.input.edge("KeyF"); })()')
        await pg.wait_for_timeout(3000)
        log('units', await js('window.__game.battle.units.length'), 'army', await js('window.__game.battle.army.units.length'), 'objective', await js('window.__game.battle.army.objective'))
        # a real mouse click on the battlefield should give the hero a move order
        log('element under click', await js('(() => { const e = document.elementFromPoint(450, 150); return e && (e.id || e.className || e.tagName); })()'))
        hx0 = await js('window.__game.battle.hero.pos.x')
        await pg.mouse.click(450, 150)
        got = None
        for _ in range(30):
            await pg.wait_for_timeout(500)
            got = await js('(() => { const h = window.__game.battle.hero; return h.moveTo ? [Math.round(h.moveTo.x), Math.round(h.moveTo.z)] : null; })()')
            if got: break
        log('click -> moveTo', got, 'hero moved', round(await js('window.__game.battle.hero.pos.x') - hx0, 1))
        # clicking where an enemy stands should target it
        pos = await js('(() => { const b = window.__game.battle; const e = b.units.find(u => u.team === 1 && u.alive); if (!e) return null; const w = innerWidth, h = innerHeight; const s = b.cam.toScreen(e.pos.clone().setY(e.pos.y + 1.2), w, h); return [s.x, s.y]; })()')
        if pos:
            await pg.mouse.click(pos[0], pos[1]); await pg.wait_for_timeout(1500)
            log('click enemy -> target', await js('(() => { const t = window.__game.battle.hero.target; return t ? t.def.name : null; })()'))
        else:
            log('no enemy on screen to click')
        if '--clicks-only' in sys.argv: await b.close(); return
        # pause and resume
        await js('window.__game.pause()'); await pg.wait_for_timeout(800)
        log('paused', await js('!!document.querySelector(".pause.on")'))
        await js('document.querySelector(\'.pause button[data-a="resume"]\').click()'); await pg.wait_for_timeout(500)
        # quality switch to high (adds AO) and back
        await js('(() => { const g = window.__game; g.settings.quality = "high"; g.applySettings(true); })()'); await pg.wait_for_timeout(4000)
        log('quality', await js('window.__game.R.qualityName'), 'ao', await js('!!window.__game.R.ao'))
        await pg.screenshot(path='/tmp/flow_high.png')
        await js('(() => { const g = window.__game; g.settings.quality = "low"; g.applySettings(true); })()'); await pg.wait_for_timeout(2000)
        # force victory
        await js('(() => { const b = window.__game.battle; b.rift.invulnerable = false; b.rift.takeDamage(1e7, b.hero); })()')
        await pg.wait_for_timeout(1500)
        log('state', await js('window.__game.battle.state'))
        await pg.wait_for_function('!!document.querySelector(".results.on")', timeout=240000)
        log('results shown')
        await pg.screenshot(path='/tmp/flow_results.png')
        await js('document.querySelector(\'.results button[data-a="go"]\').click()')
        await pg.wait_for_function('window.__game.story.active === true', timeout=60000)
        for i in range(40):
            await js('(() => { const s = window.__game.story; if (!s.active) return; if (s.choosing) s.pickChoice(0); else { s.skip = true; s.advance(true); } })()')
            await pg.wait_for_timeout(300)
            if not await js('window.__game.story.active'): break
        await pg.wait_for_function('!!document.querySelector(".camp-screen.on")', timeout=120000)
        sv = await js('JSON.parse(localStorage.getItem("lanternfall_save_v1"))')
        log('camp shown; chapter', sv['chapter'], 'gold', sv['gold'], 'flags', sv['flags'])
        for l in logs[:30]: print(l[:400])
        await b.close()
asyncio.run(main())
