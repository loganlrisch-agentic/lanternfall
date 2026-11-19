import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  const skin = root.listSkins()[0]; if (!skin) { console.log("NOSKIN", f.split("/").pop()); continue; }
  const get = n => { const j = skin.listJoints().find(x => x.getName() === n); return j ? j.getWorldTranslation().map(v=>v.toFixed(2)).join(',') : '-'; };
  const meshNodes = root.listNodes().filter(n => n.getMesh()).map(n => n.getName());
  const mats = root.listMaterials().map(m => `${m.getName()}`);
  // bbox
  let min=[1e9,1e9,1e9], max=[-1e9,-1e9,-1e9];
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'); const mn = a.getMin([]), mx = a.getMax([]); for (let i=0;i<3;i++){min[i]=Math.min(min[i],mn[i]);max[i]=Math.max(max[i],mx[i]);} }
  console.log(`${f.split('/').pop().padEnd(26)} hips=${get('hips')} head=${get('head')} hand.r=${get('handslot.r')} h=${(max[1]-min[1]).toFixed(2)} w=${(max[0]-min[0]).toFixed(2)} mats=${mats.join('|')}\n   parts: ${meshNodes.join(' ')}`);
}
