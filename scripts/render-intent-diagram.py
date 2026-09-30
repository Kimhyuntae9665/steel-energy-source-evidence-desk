"""Separate optional stored-intent graph; original CPU diagram bytes stay unchanged."""
import asyncio,hashlib,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1];DOCS=ROOT/'docs/intent-v1'
async def main():
    DOCS.mkdir(parents=True,exist_ok=True)
    glyphs={'Intent':'<path d="M8 7h32v27H24l-10 8v-8H8zM15 15h18M15 23h12"/>','Review':'<circle cx="23" cy="13" r="7"/><path d="M9 40v-7c0-10 28-10 28 0v7M29 28l5 5 9-9"/>','Query':'<path d="M6 9h36L28 26v15l-8-4V26z"/>'}
    svg='<svg xmlns="http://www.w3.org/2000/svg" width="360" height="660" viewBox="0 0 360 660"><title>Optional stored intent review branch</title><desc>Stored raw typed intent goes to human semantic review. Review can populate the visible query builder. It does not execute a query; a separate source-label confirmation is required. Generic glyphs, no technology logos or live inference claim.</desc><defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#374354"/></pattern><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9" fill="#a7b5c7"/></marker></defs><rect width="360" height="660" fill="#171e2a"/><rect width="360" height="660" fill="url(#dots)"/>'
    for start,end in [(190,255),(405,470)]:svg+=f'<path d="M180 {start}C215 {start+20} 215 {end-20} 180 {end}" stroke="#a7b5c7" stroke-width="3" fill="none" marker-end="url(#arrow)"/>'
    for name,y in [('Intent',40),('Review',255),('Query',470)]:
        svg+=f'<rect x="115" y="{y}" width="130" height="110" rx="20" fill="white" stroke="#b8c6da" stroke-width="2"/><svg x="144" y="{y+19}" width="72" height="72" viewBox="0 0 48 48"><g fill="none" stroke="#245b7c" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">{glyphs[name]}</g></svg><text x="180" y="{y+145}" fill="#dbe5f2" font-family="sans-serif" font-size="32" text-anchor="middle">{name}</text>'
    svg+='</svg>';(DOCS/'optional-branch.svg').write_text(svg+'\n')
    async with async_playwright()as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--disable-gpu']);page=await browser.new_page(viewport={'width':360,'height':660});await page.goto((DOCS/'optional-branch.svg').as_uri());await page.locator('svg').first.screenshot(path=str(DOCS/'optional-branch.png'));await browser.close()
    provenance={'glyphs':'Original MIT geometric component glyphs, not technology logos','topology':'Stored typed Intent -> human Review -> visible Query builder; execution requires separate confirmation','style_reference':'User-approved original logo-card style; no reference pixels copied','resource_embedding':'Native inline SVG paths only','fit':'Each48x48viewBox fitted72x72, aspect ratio1 preserved','files':[{'path':'docs/intent-v1/'+name,'bytes':(DOCS/name).stat().st_size,'sha256':hashlib.sha256((DOCS/name).read_bytes()).hexdigest()}for name in ['optional-branch.svg','optional-branch.png']]}
    (DOCS/'asset-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
if __name__=='__main__':asyncio.run(main())
