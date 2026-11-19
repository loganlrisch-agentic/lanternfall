import asyncio, sys, json
from playwright.async_api import async_playwright
async def main():
    url = sys.argv[1]; expr = sys.argv[2]; out = sys.argv[3] if len(sys.argv) > 3 else None
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-background-networking','--disable-component-update','--no-first-run'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if 'GL Driver' not in m.text else None)
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto(url)
        try: await pg.wait_for_function('window.__ready === true', timeout=200000)
        except Exception: logs.append('TIMEOUT')
        await pg.wait_for_timeout(int(sys.argv[4]) if len(sys.argv) > 4 else 500)
        r = await pg.evaluate(expr)
        print(json.dumps(r, indent=1)[:4000])
        if out: await pg.screenshot(path=out, timeout=120000)
        for l in logs[-15:]: print(l[:500])
        await b.close()
asyncio.run(main())
