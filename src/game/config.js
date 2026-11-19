// Battlefield layout shared by world building and gameplay.
import { smoothstep } from '../core/util.js';

export const MAP = {
  castleX: -70,        // wall line
  gateHalf: 5.2,       // half width of the gate opening
  wallHalf: 31,        // walls span |z| <= wallHalf
  keepX: -92,
  fortressX: 88,
  playZ: 30,
  xMin: -104, xMax: 104,
  spawnX: -63,         // allied spawn point in front of the gate
};

export function roadZ(x) {
  const env = smoothstep(-66, -44, x) * smoothstep(84, 60, x);
  return (Math.sin(x * 0.045 + 0.6) * 5 + Math.sin(x * 0.017 + 2.1) * 3.5) * env;
}

export const TEAM = { PLAYER: 0, ENEMY: 1 };
