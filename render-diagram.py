"""Original generic glyphs, rendered with installed CPU Chrome; no external assets."""
import asyncio,hashlib,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent
glyphs={
'CSV':'<path d="M12 6h20l8 8v29H8V6z"/><path d="M30 6v10h10M12 23h24M12 30h24M12 37h24M20 23v14M28 23v14"/>',
'Audit':'<circle cx="21" cy="21" r="14"/><path d="m12 21 6 6 12-12M31 32l11 11"/>',
'Query':'<path d="M6 9h36L28 26v15l-8-4V26z"/>',
'Chart':'<path d="M7 5v38h36M15 35V25h5v10M25 35V14h5v21M35 35V7h5v28"/>',
'Receipt':'<path d="M10 5h29v38l-5-3-5 3-5-3-5 3-5-3-4 3zM16 13h17M16 20h17M16 27h9"/><path d="m26 31 4 4 8-8"/>'}
positions={'CSV':(40,210),'Audit':(290,40),'Query':(290,375),'Chart':(540,180),'Receipt':(540,460)}
async def main():
    docs=ROOT/'docs';docs.mkdir(exist_ok=True)
    svg='<svg xmlns="http://www.w3.org/2000/svg" width="720" height="660" viewBox="0 0 720 660"><title>Verified CPU source evidence flow</title><desc>Immutable CSV feeds audit and allowlisted query. Query feeds the native chart and exact row receipt. Generic original glyphs represent components, not technology logos or vendor integration.</desc><defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#374354"/></pattern><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9" fill="#a7b5c7"/></marker></defs><rect width="720" height="660" fill="#171e2a"/><rect width="720" height="660" fill="url(#dots)"/>'
    for d in ['M170 245C225 245 235 95 290 95','M170 285C225 285 235 420 290 420','M420 415C480 415 480 235 540 235','M420 445C475 445 490 515 540 515']:
        svg+='<path d="'+d+'" stroke="#a7b5c7" stroke-width="3" fill="none" marker-end="url(#arrow)"/>'
    for name,(x,y)in positions.items():
        svg+=f'<rect x="{x}" y="{y}" width="130" height="110" rx="20" fill="white" stroke="#b8c6da" stroke-width="2"/><svg x="{x+29}" y="{y+19}" width="72" height="72" viewBox="0 0 48 48"><g fill="none" stroke="#245b7c" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">{glyphs[name]}</g></svg><text x="{x+65}" y="{y+145}" fill="#dbe5f2" font-family="sans-serif" font-size="32" text-anchor="middle">{name}</text>'
    svg+='</svg>';path=docs/'architecture.svg';path.write_text(svg+'\n')
    async with async_playwright()as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--disable-gpu']);page=await browser.new_page(viewport={'width':720,'height':660},device_scale_factor=1);await page.goto(path.as_uri());await page.locator('svg').first.screenshot(path=str(docs/'architecture.png'));await browser.close()
    manifest={'glyphs':'Original MIT generic geometric component artwork; no brand logos','reference':'User-approved synthetic-logo-rendering-compatibility-test.png v1; style only, no pixels copied','topology':'CSV -> Audit; CSV -> Query; Query -> Chart; Query -> Receipt','resources_embedded':True,'glyph_viewbox':'48x48; fitted72x72 preserves aspect ratio','caption':'Implemented CPU prototype only; no LLM, live system, private vendor architecture or control path','files':[{ 'path':'docs/'+n,'sha256':hashlib.sha256((docs/n).read_bytes()).hexdigest(),'bytes':(docs/n).stat().st_size}for n in ['architecture.svg','architecture.png']]}
    (docs/'asset-provenance.json').write_text(json.dumps(manifest,indent=2)+'\n')
if __name__=='__main__':asyncio.run(main())
