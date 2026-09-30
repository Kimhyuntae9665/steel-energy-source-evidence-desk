import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
test('published original archive and CSV retain their independently pinned admission bytes',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../data/admission.json',import.meta.url))),csv=readFileSync(new URL('../data/Steel_industry_data.csv',import.meta.url)),zip=readFileSync(new URL('../data/steel-industry-energy-consumption.zip',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
 assert.equal(sha(zip),'d82d28b33780ff1582507fcf08ae764ff648af459d58234370c551e62aadeaef');assert.equal(sha(csv),'9b1cee6f9cb9cd9df2b95814ca90a9a2ff15b7f5f1fba0fae3c643e82072eacc');assert.equal(zip.length,481973);assert.equal(csv.length,2731389);assert.equal(manifest.archive_sha256,sha(zip));assert.equal(manifest.csv_sha256,sha(csv));assert.equal(manifest.original_modified,false);assert.equal(manifest.license,'CC BY 4.0');
});
