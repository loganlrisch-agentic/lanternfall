import asyncio, json
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
        # summon, give orders, use abilities via the input edge system
        await js('(() => { const g = window.__game; g.battle.cp = 30; g.input.edge("Digit1"); g.input.edge("Digit2"); g.input.edge("KeyX"); g.input.edge("KeyQ"); g.input.edge("KeyF"); })()')
        await pg.wait_for_timeout(3000)
        log('units', await js('window.__game.battle.units.length'), 'order', await js('window.__game.battle.order'))
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
