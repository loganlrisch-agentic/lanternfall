import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    url = sys.argv[1]
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-background-networking','--disable-component-update','--no-first-run'])
        pg = await b.new_page(viewport={'width': 960, 'height': 540})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(url)
        try: await pg.wait_for_function('window.__ready === true', timeout=200000)
        except Exception as e: logs.append('TIMEOUT')
        for l in logs:
            if 'GL Driver' in l: continue
            print(l[:3000]); print('======')
        await b.close()
asyncio.run(main())
