import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  try {
    const doc = await io.read(f);
    const scene = doc.getRoot().listScenes()[0];
    const b = getBounds(scene);
    const s = b.max.map((v,i)=>(v-b.min[i]).toFixed(2));
    let tris=0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i=p.getIndices(); tris += i? i.getCount()/3:0; }
    const tex = doc.getRoot().listTextures().map(t=>t.getURI()).join(',');
    console.log(`${f.split('/').pop().padEnd(36)} size=${s.join('x')} minY=${b.min[1].toFixed(2)} tris=${tris} tex=${tex}`);
  } catch(e) { console.log('ERR', f, e.message); }
}
