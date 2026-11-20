import asyncio, sys, json, time
from playwright.async_api import async_playwright
async def main():
    url = sys.argv[1]; out = sys.argv[2]; wait = float(sys.argv[3]) if len(sys.argv) > 3 else 60
    w = int(sys.argv[4]) if len(sys.argv) > 4 else 1280; h = int(sys.argv[5]) if len(sys.argv) > 5 else 720
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True,
            args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-sync', '--disable-features=Translate,OptimizationHints,MediaRouter'])
        pg = await b.new_page(viewport={'width': w, 'height': h})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        t0 = time.time()
        await pg.goto(url)
        try:
            # poll instead of wait_for_function so pages under a strict CSP (no eval) still work
            while not await pg.evaluate('window.__ready === true'):
                if time.time() - t0 > wait: raise TimeoutError('not ready after %ss' % wait)
                await asyncio.sleep(1)
        except Exception as e:
            logs.append('TIMEOUT waiting for ready ' + str(e)[:200])
        info = await pg.evaluate('window.__info || null')
        print('time', round(time.time() - t0, 1), 'info', json.dumps(info))
        for l in logs[-40:]: print(l[:400])
        await pg.screenshot(path=out, timeout=120000)
        await b.close()
asyncio.run(main())
