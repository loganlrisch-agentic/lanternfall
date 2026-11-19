// Asset pipeline: turns KayKit CC0 packs (cloned from GitHub) into compact GLBs for the game.
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, meshopt, resample, mergeDocuments } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Run tools/fetch-assets.sh first (or point VENDOR at your own clones of the packs).
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VENDOR = process.env.VENDOR || path.join(ROOT, 'vendor');
const CH = `${VENDOR}/GeorgeQLe_assets-kaykit-3d-characters/repo/assets/kaykit`;
const ENV = `${VENDOR}/GeorgeQLe_assets-kaykit-3d-environments/repo/assets/kaykit`;
const HW = `${VENDOR}/KayKit_Halloween/repo/addons/kaykit_halloween_bits/Assets/gltf`;
const OUT = path.join(ROOT, 'public/assets');
const only = process.argv[2] || 'all';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}
const chFiles = walk(CH);
const envFiles = walk(ENV).concat(walk(HW));
function findCh(base) {
  const hits = chFiles.filter(f => path.basename(f) === base && !f.includes('/fbx') && !f.includes('/obj'));
  if (!hits.length) throw new Error('missing ' + base);
  return hits.sort((a, b) => a.length - b.length)[0];
}
function findEnv(base, hint = '') {
  const hits = envFiles.filter(f => path.basename(f) === base && f.includes(hint));
  if (!hits.length) throw new Error('missing env ' + base + ' ' + hint);
  return hits.sort((a, b) => a.length - b.length)[0];
}

const compress = (size = 512, volume = 'mesh') => [
  dedup(),
  prune({ keepLeaves: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 88 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizationVolume: volume }),
];

function kb(p) { return (fs.statSync(p).size / 1024).toFixed(0) + 'KB'; }

// ---------------- characters ----------------
const CHARACTERS = [
  'Knight', 'Barbarian', 'Barbarian_Large', 'Druid', 'Engineer', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded',
  'Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Mage', 'Necromancer', 'Skeleton_Golem',
  'OrcRaider', 'OrcBrute', 'Paladin', 'Paladin_with_Helmet', 'Werewolf_Man', 'Werewolf_Wolf', 'Ninja',
  'BlackKnight', 'Vampire', 'Witch', 'FrostGolem', 'Caveman', 'Tiefling', 'Lorekeeper', 'Marksman',
  'Farmer_A', 'Farmer_B', 'Cleric', 'Monstrosity', 'PlantWarrior', 'ToySoldier', 'Hoarder', 'AvianSwordsman',
];

async function buildCharacters() {
  fs.mkdirSync(`${OUT}/chars`, { recursive: true });
  for (const name of CHARACTERS) {
    const src = findCh(name + '.glb');
    const doc = await io.read(src);
    doc.getRoot().listAnimations().forEach(a => a.dispose());
    await doc.transform(...compress(512, 'scene'));
    const out = `${OUT}/chars/${name}.glb`;
    await io.write(out, doc);
    console.log('char', name, kb(src), '->', kb(out));
  }
}

// ---------------- animations ----------------
const MED = `${CH}/character-animations-1.1/Animations/gltf/Rig_Medium`;
const LRG = `${CH}/character-animations-1.1/Animations/gltf/Rig_Large`;
const ANIM_PACKS = {
  anim_medium: [
    [`${MED}/Rig_Medium_General.glb`, ['Death_A', 'Death_B', 'Hit_A', 'Hit_B', 'Idle_A', 'Idle_B', 'Interact', 'PickUp', 'Spawn_Air', 'Spawn_Ground', 'Throw', 'Use_Item']],
    [`${MED}/Rig_Medium_MovementBasic.glb`, ['Running_A', 'Running_B', 'Walking_A', 'Walking_B', 'Walking_C', 'Jump_Full_Short']],
    [`${MED}/Rig_Medium_MovementAdvanced.glb`, ['Dodge_Forward', 'Dodge_Backward', 'Dodge_Left', 'Dodge_Right', 'Running_HoldingBow', 'Running_Strafe_Left', 'Running_Strafe_Right', 'Walking_Backwards']],
    [`${MED}/Rig_Medium_CombatMelee.glb`, '*'],
    [`${MED}/Rig_Medium_CombatRanged.glb`, '*'],
    [`${MED}/Rig_Medium_Simulation.glb`, ['Cheering', 'Waving', 'Sit_Floor_Idle', 'Lie_Idle']],
    [`${MED}/Rig_Medium_Special.glb`, ['Skeletons_Awaken_Floor', 'Skeletons_Death', 'Skeletons_Idle', 'Skeletons_Spawn_Ground', 'Skeletons_Taunt', 'Skeletons_Walking', 'Skeletons_Death_Resurrect']],
    [`${MED}/Rig_Medium_Tools.glb`, ['Hammering', 'Working_A']],
  ],
  anim_large: [
    [`${LRG}/Rig_Large_General.glb`, ['Death_A', 'Hit_A', 'Idle_A', 'Idle_B']],
    [`${LRG}/Rig_Large_MovementBasic.glb`, ['Running_A', 'Walking_A']],
    [`${LRG}/Rig_Large_MovementAdvanced.glb`, ['Dodge_Forward']],
    [`${LRG}/Rig_Large_CombatMelee.glb`, '*'],
    [`${LRG}/Rig_Large_Simulation.glb`, ['Flexing']],
  ],
};

function keepAnim(name, keep) {
  if (/T-Pose|_Pose$/.test(name)) return false;
  return keep === '*' || keep.includes(name);
}

async function buildAnims() {
  fs.mkdirSync(`${OUT}/anims`, { recursive: true });
  for (const [packName, files] of Object.entries(ANIM_PACKS)) {
    const base = await io.read(files[0][0]);
    const root = base.getRoot();
    const buf = root.listBuffers()[0];
    const nodesByName = new Map(root.listNodes().map(n => [n.getName(), n]));
    for (const a of root.listAnimations()) if (!keepAnim(a.getName(), files[0][1])) a.dispose();
    for (const [file, keep] of files.slice(1)) {
      const src = await io.read(file);
      for (const anim of src.getRoot().listAnimations()) {
        if (!keepAnim(anim.getName(), keep)) continue;
        const na = base.createAnimation(anim.getName());
        for (const ch of anim.listChannels()) {
          const target = nodesByName.get(ch.getTargetNode().getName());
          if (!target) continue;
          const s = ch.getSampler();
          const inp = base.createAccessor().setType(s.getInput().getType()).setArray(s.getInput().getArray().slice()).setBuffer(buf);
          const outp = base.createAccessor().setType(s.getOutput().getType()).setArray(s.getOutput().getArray().slice())
            .setNormalized(s.getOutput().getNormalized()).setBuffer(buf);
          const ns = base.createAnimationSampler().setInput(inp).setOutput(outp).setInterpolation(s.getInterpolation());
          const nc = base.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(ns);
          na.addSampler(ns).addChannel(nc);
        }
      }
    }
    // drop scale channels (lets the game rescale heads) and the preview mannequin mesh
    for (const a of root.listAnimations()) for (const c of a.listChannels()) if (c.getTargetPath() === 'scale') { const s = c.getSampler(); c.dispose(); s.dispose(); }
    for (const n of root.listNodes()) { if (n.getMesh()) n.setMesh(null); if (n.getSkin()) n.setSkin(null); }
    root.listMeshes().forEach(m => m.dispose());
    root.listSkins().forEach(s => s.dispose());
    root.listMaterials().forEach(m => m.dispose());
    root.listTextures().forEach(t => t.dispose());
    await base.transform(resample({ tolerance: 1e-4 }), prune({ keepLeaves: true }), dedup());
    const out = `${OUT}/anims/${packName}.glb`;
    await io.write(out, base);
    console.log(packName, root.listAnimations().length, 'clips', kb(out), root.listAnimations().map(a => a.getName()).join(' '));
  }
}

// ---------------- scene packs (props / environment) ----------------
async function buildScenePack(name, items, texSize = 512, patch = {}) {
  const target = new Document();
  target.createBuffer('main');
  for (const [id, file] of items) {
    const src = await io.read(file);
    const scenes = src.getRoot().listScenes();
    scenes.forEach((s, i) => s.setName(i === 0 ? id : `${id}_${i}`));
    src.getRoot().listAnimations().forEach(a => a.dispose());
    mergeDocuments(target, src);
  }
  const root = target.getRoot();
  const buf = root.listBuffers()[0];
  root.listAccessors().forEach(a => a.setBuffer(buf));
  root.listBuffers().forEach(b => { if (b !== buf) b.dispose(); });
  root.setDefaultScene(root.listScenes()[0]);
  for (const t of root.listTextures()) for (const [k, file] of Object.entries(patch)) if ((t.getURI() + t.getName()).includes(k)) t.setImage(fs.readFileSync(file));
  await target.transform(...compress(texSize));
  const out = `${OUT}/${name}.glb`;
  await io.write(out, target);
  console.log(name, items.length, 'scenes', kb(out));
}

const ADV = `${CH}/adventurers-2.0/Assets/gltf`;
const SKA = `${CH}/skeletons-1.1/assets/gltf`;
const PROPS = [
  ...['sword_1handed', 'sword_2handed', 'sword_2handed_color', 'axe_1handed', 'axe_2handed', 'axe_2handed_Large', 'axe_1handed_Large',
    'bow_withString', 'crossbow_1handed', 'crossbow_2handed', 'dagger', 'druid_staff', 'engineer_Wrench', 'staff', 'wand', 'spellbook_open',
    'shield_round', 'shield_round_color', 'shield_square', 'shield_square_color', 'shield_badge', 'shield_badge_color', 'shield_spikes_color',
    'shield_round_barbarian', 'shield_round_barbarian_Large', 'arrow_bow', 'arrow_crossbow', 'quiver', 'potion_large_red', 'potion_medium_blue',
    'smokebomb', 'mug_full'].map(n => [n, `${ADV}/${n}.gltf`]),
  ...['Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Crossbow', 'Skeleton_Staff', 'Skeleton_Shield_Small_A', 'Skeleton_Shield_Small_B',
    'Skeleton_Shield_Large_A', 'Skeleton_Shield_Large_B', 'Skeleton_Golem_Axe_Large', 'Skeleton_Mace', 'Skeleton_Mace_Large', 'Skeleton_Scythe',
    'Skeleton_Dagger', 'Skeleton_Arrow'].map(n => [n, `${SKA}/${n}.gltf`]),
  ['Orc_Axe', findCh('Orc_Axe.gltf.glb')], ['Orc_Club', findCh('Orc_Club.gltf.glb')], ['Orc_Wardrum', findCh('Orc_Wardrum.gltf.glb')],
  ['Orc_WardrumStick', findCh('Orc_WardrumStick.gltf.glb')],
  ...['Orc_Axe_Large', 'Orc_Banner', 'Orc_Banner_Large', 'paladin_hammer', 'paladin_shield', 'paladin_book', 'Ninja_Katana', 'Ninja_Shuriken',
    'BlackKnight_Sword_Large', 'BlackKnight_Shield_Large', 'BlackKnight_Sword', 'BlackKnight_Shield', 'Vampire_Sword', 'Broom', 'Cauldron',
    'FrostGolem_Axe_Large', 'Caveman_Club', 'Caveman_Spear', 'Caveman_Axe', 'Tiefling_Sword', 'Lorekeeper_Staff', 'Lorekeeper_Tome',
    'Marksman_Rifle', 'pitchfork', 'Cleric_Mace', 'Cleric_Shield', 'Cleric_Tome', 'Monstrosity_Pitchfork_Large', 'Monstrosity_BarndoorShield_Large',
    'PlantWarrior_Spear', 'PlantWarrior_Shield', 'PlantWarrior_Bow_withString', 'ToySoldier_Rifle', 'ToySoldier_Trumpet', 'AvianSwordsman_Sword',
    'Gem_Large', 'Vampire_Throne', 'Campfire_Base', 'Campfire_Logs'].map(n => [n, findCh(n + '.gltf')]),
];

const HEX = `${ENV}/medieval-hexagon-pack-1.0.1/Assets/gltf`;
const hexB = (n, c) => [`${n}_${c}`, `${HEX}/buildings/${c}/building_${n}_${c}.gltf`];
const ENV_HEX = [
  ...['castle', 'tower_A', 'tower_B', 'tower_base', 'watchtower', 'barracks', 'church', 'tent', 'shrine', 'windmill', 'home_A', 'home_B',
    'archeryrange', 'blacksmith', 'stables', 'tavern', 'market', 'well', 'townhall', 'workshop', 'tower_catapult'].map(n => hexB(n, 'blue')),
  ...['castle', 'tower_A', 'tower_B', 'tower_base', 'watchtower', 'tent', 'shrine', 'barracks', 'church'].map(n => hexB(n, 'red')),
  ...['tent', 'shrine', 'home_A'].map(n => hexB(n, 'green')),
  ...['tent', 'workshop', 'blacksmith', 'mine'].map(n => hexB(n, 'yellow')),
  ...['wall_straight', 'wall_straight_gate', 'wall_corner_A_outside', 'wall_corner_A_inside', 'fence_stone_straight', 'fence_wood_straight',
    'fence_wood_straight_gate', 'building_destroyed', 'building_scaffolding', 'building_grain', 'building_bridge_A', 'projectile_catapult']
    .map(n => [n, `${HEX}/buildings/neutral/${n}.gltf`]),
  ...['catapult_blue_full', 'cannon_blue_full', 'spear_blue_full', 'banner_blue_full', 'horse_blue_full'].map(n => [n, `${HEX}/units/blue/${n}.gltf`]),
  ...['catapult_red_full', 'cannon_red_full', 'banner_red_full', 'spear_red_full'].map(n => [n, `${HEX}/units/red/${n}.gltf`]),
  ...['cart', 'projectile_arrow', 'projectile_cannonball'].map(n => [n, `${HEX}/units/neutral/${n}.gltf`]),
  ...['trees_A_large', 'trees_A_medium', 'trees_A_small', 'trees_B_large', 'trees_B_medium', 'tree_single_A', 'tree_single_B',
    'mountain_A', 'mountain_B', 'mountain_C', 'mountain_A_grass', 'mountain_B_grass_trees', 'mountain_C_grass', 'hills_A_trees', 'hills_B',
    'hill_single_A', 'rock_single_A', 'rock_single_C', 'rock_single_E', 'cloud_big', 'cloud_small'].map(n => [n, `${HEX}/decoration/nature/${n}.gltf`]),
  ...['barrel', 'crate_A_big', 'crate_B_big', 'crate_long_A', 'flag_blue', 'flag_red', 'flag_green', 'flag_yellow', 'haybale', 'weaponrack',
    'target', 'sack', 'wheelbarrow', 'bucket_arrows', 'ladder', 'pallet', 'resource_lumber', 'resource_stone', 'trough'].map(n => [n, `${HEX}/decoration/props/${n}.gltf`]),
];

const FOR = `${ENV}/forest-nature-pack-1.0/Assets/gltf`;
const ENV_FOREST = [
  ...['Tree_1_A', 'Tree_1_B', 'Tree_2_A', 'Tree_2_C', 'Tree_3_A', 'Tree_3_B', 'Tree_4_A', 'Tree_5_A', 'Tree_6_A', 'Tree_7_A', 'Tree_Bare_1_A',
    'Tree_Bare_2_A', 'Bush_1_A', 'Bush_1_C', 'Bush_2_A', 'Bush_3_A', 'Bush_4_A', 'Grass_1_A', 'Grass_1_B', 'Grass_2_A', 'Grass_2_B',
    'Rock_1_A', 'Rock_2_A', 'Rock_3_A', 'Rock_3_E', 'Rock_4_A', 'Rock_5_A', 'Rock_6_A', 'Rock_6_C'].map(n => [n, `${FOR}/Color1/${n}_Color1.gltf`]),
  ...[2, 3, 4, 5, 6, 7, 8].flatMap(c => ['Tree_1_A', 'Tree_2_A', 'Tree_3_A', 'Tree_4_A', 'Tree_5_A', 'Tree_6_A', 'Tree_7_A', 'Bush_1_A', 'Bush_2_A', 'Bush_3_A', 'Bush_4_A', 'Grass_1_A', 'Grass_2_A']
    .map(n => [`${n}_c${c}`, `${FOR}/Color${c}/${n}_Color${c}.gltf`])),
];

const DUN = `${ENV}/dungeon-remastered-1.1/Assets/gltf`;
const ENV_DUNGEON = ['torch_lit', 'torch_mounted', 'banner_patternA_blue', 'banner_patternB_blue', 'banner_shield_blue', 'banner_thin_blue',
  'banner_triple_blue', 'banner_patternA_red', 'banner_shield_red', 'banner_thin_red', 'banner_patternC_green', 'banner_shield_yellow',
  'pillar', 'pillar_decorated', 'column', 'barrel_large', 'barrel_small_stack', 'crates_stacked', 'chest_gold', 'sword_shield', 'rubble_large',
  'rubble_half', 'rocks_decorated', 'coin_stack_large', 'keg', 'bench', 'table_long_decorated_A', 'candle_lit', 'post', 'wall_broken',
  'stairs', 'scaffold_pillars_connected_torch'].map(n => [n, findEnv(n + '.gltf', 'dungeon-remastered')]);

const ENV_HALLOWEEN = ['lantern_standing', 'lantern_hanging', 'post_lantern', 'crypt', 'gravestone', 'grave_A', 'grave_A_destroyed', 'grave_B',
  'gravemarker_A', 'gravemarker_B', 'tree_dead_large', 'tree_dead_medium', 'tree_dead_small', 'tree_dead_large_decorated', 'arch', 'arch_gate',
  'fence', 'fence_broken', 'fence_pillar', 'shrine', 'shrine_candles', 'skull', 'skull_candle', 'ribcage', 'bone_A', 'bone_B', 'candle_triple',
  'coffin', 'post_skull', 'plaque_candles', 'tree_pine_yellow_large', 'tree_pine_orange_large', 'tree_pine_yellow_medium', 'pillar']
  .map(n => [`hw_${n}`, `${HW}/${n}.gltf`]);

if (only === 'all' || only === 'chars') await buildCharacters();
if (only === 'all' || only === 'anims') await buildAnims();
if (only === 'all' || only === 'props') await buildScenePack('props', PROPS, 512);
if (only === 'all' || only === 'env') {
  await buildScenePack('env_hex', ENV_HEX, 1024);
  await buildScenePack('env_forest', ENV_FOREST, 512, { forest_texture: path.join(ROOT, 'tools/tex/forest_texture_brown.png') });
  await buildScenePack('env_dungeon', ENV_DUNGEON, 512);
  await buildScenePack('env_halloween', ENV_HALLOWEEN, 512);
}
console.log('done');
