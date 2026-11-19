import asyncio, sys, json
from playwright.async_api import async_playwright
SAVE = {"v":1,"hero":"knight","difficulty":"normal","chapter":3,"level":4,"xp":20,"valor":3,"talents":{"shieldCharge":1},"gold":1240,"flags":{"spareCursed":True},"unitLevels":{"footman":2},"upgrades":{"walls":1,"towers":2},"loadout":["militia","footman","archer","bannerman","cleric"],"seenUnlocks":[],"stats":{"kills":214,"battles":2,"lost":31},"created":0}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-background-networking','--disable-component-update','--no-first-run'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        logs = []
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
        await pg.goto('http://127.0.0.1:8124/index.html')
        await pg.evaluate('s => localStorage.setItem("lanternfall_save_v1", JSON.stringify(s))', SAVE)
        await pg.wait_for_function('document.querySelector(".title-screen.on") !== null', timeout=240000)
        await pg.evaluate('document.querySelector(\'button[data-a="new"]\').click()'); await pg.wait_for_timeout(300)
        await pg.evaluate('document.querySelector(\'.modal button[data-a="yes"]\').click()'); await pg.wait_for_timeout(5000)
        await pg.screenshot(path='/tmp/ui_hero.png', timeout=120000)
        await pg.evaluate('document.querySelector(\'button[data-a="back"]\').click()'); await pg.wait_for_timeout(4000)
        await pg.evaluate('document.querySelector(\'button[data-a="continue"]\').click()'); await pg.wait_for_timeout(5000)
        await pg.evaluate('document.querySelector(\'.ucard[data-u="paladin"]\').click()'); await pg.wait_for_timeout(4000)
        await pg.screenshot(path='/tmp/ui_camp.png', timeout=120000)
        await pg.evaluate('document.querySelector(\'.tabs button[data-t="hero"]\').click()'); await pg.wait_for_timeout(4000)
        await pg.screenshot(path='/tmp/ui_camp2.png', timeout=120000)
        for l in logs: print(l[:300])
        await b.close()
asyncio.run(main())
