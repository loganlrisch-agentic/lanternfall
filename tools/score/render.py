# Renders the score offline for a few scripted scenes and writes WAV/MP3 previews plus loudness stats.
# Usage: python3 tools/score/render.py OUTDIR scene1,scene2,...   (needs a server on :8125 at the repo root)
import asyncio, sys, base64, json, subprocess
from playwright.async_api import async_playwright
out, scenes = sys.argv[1], sys.argv[2].split(',')
mute = sys.argv[3].split(',') if len(sys.argv) > 3 else []
tag = ('_no_' + '_'.join(mute)) if mute else ''
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text[:300]))
        await pg.goto('http://127.0.0.1:8125/tools/score/harness.html')
        await pg.wait_for_function('window.ready === true', timeout=30000)
        for sc in scenes:
            r = await pg.evaluate(f'window.render({json.dumps(sc)}, 24000, {json.dumps(mute)})')
            wav = f'{out}/{sc}{tag}.wav'
            open(wav, 'wb').write(base64.b64decode(r.pop('wav')))
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '160k', f'{out}/{sc}{tag}.mp3'])
            print(sc, json.dumps(r))
        print('errors:', errs or 'none')
        await b.close()
asyncio.run(main())
