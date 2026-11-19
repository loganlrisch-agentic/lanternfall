import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'fs';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
const mode = process.argv[2];
const files = process.argv.slice(3);
for (const f of files) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  const size = (fs.statSync(f).size/1024).toFixed(0);
  const name = f.split('/').pop();
  const meshes = root.listMeshes();
  const skins = root.listSkins();
  const anims = root.listAnimations();
  const tex = root.listTextures().map(t => { const s = t.getSize(); return `${t.getName()||t.getURI()}:${s?s.join('x'):'?'}`; });
  let tris = 0; for (const m of meshes) for (const p of m.listPrimitives()) { const i = p.getIndices(); tris += i ? i.getCount()/3 : 0; }
  console.log(`\n### ${name} ${size}KB meshes=${meshes.length} tris=${tris} skins=${skins.length} joints=${skins[0]?skins[0].listJoints().length:0} anims=${anims.length} mats=${root.listMaterials().length} tex=[${tex.join(',')}]`);
  if (mode === 'full') {
    if (skins[0]) console.log('JOINTS:', skins[0].listJoints().map(j=>j.getName()).join(' '));
    const nodes = root.listNodes().filter(n => n.getMesh()).map(n => n.getName() + (n.getSkin()?'(skinned)':''));
    console.log('MESHNODES:', nodes.join(' '));
    const others = root.listNodes().filter(n => !n.getMesh() && !(skins[0] && skins[0].listJoints().includes(n))).map(n=>n.getName());
    console.log('OTHERNODES:', others.join(' '));
  }
  if (mode === 'anims' || mode === 'full') {
    console.log('ANIMS:', anims.map(a => { let d=0; for (const s of a.listSamplers()) { const arr=s.getInput().getArray(); d=Math.max(d, arr[arr.length-1]); } return `${a.getName()}(${d.toFixed(2)})`; }).join(' '));
  }
}
