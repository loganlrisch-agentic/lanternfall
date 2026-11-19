import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    url, out, wait = sys.argv[1], sys.argv[2], int(sys.argv[3])
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-background-networking','--disable-component-update','--no-first-run'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if 'GL Driver' not in m.text else None)
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(url)
        await pg.wait_for_function('document.querySelector(".title-screen.on") !== null', timeout=240000)
        await pg.wait_for_timeout(wait)
        if len(sys.argv) > 4:
            for sel in sys.argv[4].split('|'):
                await pg.click(sel, timeout=60000); await pg.wait_for_timeout(wait)
        await pg.screenshot(path=out, timeout=120000)
        for l in logs[-10:]: print(l[:400])
        await b.close()
asyncio.run(main())
