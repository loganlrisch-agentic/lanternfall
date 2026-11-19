import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const skins = doc.getRoot().listSkins();
  const ref = skins[0].getInverseBindMatrices().getArray();
  let same = true, order = true;
  const names0 = skins[0].listJoints().map(j=>j.getName()).join();
  for (const s of skins) { const a = s.getInverseBindMatrices().getArray(); for (let i=0;i<a.length;i++) if (Math.abs(a[i]-ref[i])>1e-5) { same=false; break; } if (s.listJoints().map(j=>j.getName()).join()!==names0) order=false; }
  console.log(f.split('/').pop(), 'skins', skins.length, 'identicalIBM', same, 'sameOrder', order);
}
