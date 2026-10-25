import type React from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Color, PieceType } from '@nocturne/chess-shared';
// Type-only side effect: registers @react-three/fiber's <group>/<mesh> JSX
// intrinsic elements when this module is type-checked in isolation.
import type {} from '@react-three/fiber';

/**
 * Procedural, asset-free chess set for the Nocturne atelier.
 *
 * Every piece is built once at module load from lathed turning profiles,
 * beveled extrusions and a few turned details. The resulting merged geometries
 * and physical materials are shared by all 32 instances, so mounting pieces
 * costs draw calls, not geometry allocation. Nothing here touches the network
 * and there are no textures.
 *
 * Canonical units: one board square is 1.0, the root group sits on y = 0 with
 * the underside of the plinth exactly at y = 0. The widest plinth is 0.668
 * across, leaving a calm margin inside a square. Heights are given by
 * `PIECE_HEIGHTS`.
 */
export const PIECE_HEIGHTS: Record<PieceType, number> = {
  p: 0.74,
  n: 0.98,
  b: 1.05,
  r: 0.92,
  q: 1.22,
  k: 1.34,
};

/** Radial resolution for every turned surface. 48 is smooth at piece scale. */
const LATHE_SEGMENTS = 48;
const BASE_TOP = 0.136;

/**
 * A shared plinth / foot for the whole set: a 0.668-wide foundation disc with
 * a chamfered lower edge, an ogee cove and a small astragal bead. Each piece
 * continues this same silhouette upward, so the family reads as one turned
 * collection rather than six unrelated models.
 */
const BASE_PROFILE: readonly Point2[] = [
  [0.0, 0.0],
  [0.3, 0.0],
  [0.326, 0.006],
  [0.334, 0.018],
  [0.334, 0.04],
  [0.323, 0.052],
  [0.299, 0.06],
  [0.276, 0.069],
  [0.262, 0.08],
  [0.264, 0.089],
  [0.281, 0.096],
  [0.286, 0.104],
  [0.276, 0.114],
  [0.251, 0.122],
  [0.224, 0.13],
  [0.206, BASE_TOP],
];

type Point2 = readonly [number, number];
type Vec3 = [number, number, number];

/**
 * Lathe profiles for the turned body of each piece. The first point starts
 * inside the plinth's top edge so there is no seam or gap; everything above
 * is a single continuous surface.
 */
const PAWN_PROFILE: readonly Point2[] = [
  [0.194, 0.142],
  [0.184, 0.16],
  [0.171, 0.186],
  [0.156, 0.216],
  [0.143, 0.248],
  [0.134, 0.279],
  [0.137, 0.305],
  [0.148, 0.326],
  [0.155, 0.344],
  [0.151, 0.362],
  [0.139, 0.382],
  [0.122, 0.405],
  [0.108, 0.429],
  [0.097, 0.453],
  [0.086, 0.478],
  [0.08, 0.501],
  [0.075, 0.524],
  [0.069, 0.545],
  [0.065, 0.56],
];

const BISHOP_PROFILE: readonly Point2[] = [
  [0.197, 0.142],
  [0.187, 0.162],
  [0.171, 0.188],
  [0.154, 0.218],
  [0.141, 0.249],
  [0.133, 0.28],
  [0.138, 0.308],
  [0.15, 0.33],
  [0.157, 0.346],
  [0.153, 0.362],
  [0.14, 0.382],
  [0.124, 0.406],
  [0.112, 0.432],
  [0.106, 0.456],
  [0.108, 0.476],
  [0.116, 0.491],
  [0.111, 0.507],
  [0.104, 0.528],
  [0.107, 0.551],
  [0.12, 0.576],
  [0.14, 0.6],
  [0.162, 0.626],
  [0.181, 0.654],
  [0.192, 0.682],
  [0.195, 0.706],
  [0.189, 0.733],
  [0.176, 0.757],
  [0.158, 0.778],
  [0.142, 0.796],
  [0.134, 0.813],
  [0.133, 0.828],
  [0.139, 0.842],
  [0.153, 0.861],
  [0.165, 0.884],
  [0.169, 0.91],
  [0.162, 0.938],
  [0.149, 0.965],
  [0.132, 0.989],
  [0.111, 1.009],
  [0.087, 1.024],
  [0.062, 1.035],
  [0.038, 1.043],
  [0.018, 1.048],
  [0.0, 1.05],
];

const ROOK_PROFILE: readonly Point2[] = [
  [0.198, 0.142],
  [0.191, 0.163],
  [0.177, 0.19],
  [0.164, 0.22],
  [0.157, 0.251],
  [0.154, 0.282],
  [0.16, 0.312],
  [0.169, 0.34],
  [0.17, 0.37],
  [0.162, 0.4],
  [0.158, 0.43],
  [0.161, 0.46],
  [0.167, 0.49],
  [0.171, 0.52],
  [0.17, 0.545],
  [0.176, 0.565],
  // The capital flares into a crenellated drum; the last points dish the top
  // slightly so the open center reads as a recess, not a floating lid.
  [0.197, 0.588],
  [0.216, 0.612],
  [0.232, 0.638],
  [0.241, 0.664],
  [0.243, 0.684],
  [0.239, 0.698],
  [0.221, 0.71],
  [0.185, 0.718],
  [0.132, 0.724],
  [0.072, 0.727],
  [0.0, 0.725],
];

const QUEEN_PROFILE: readonly Point2[] = [
  [0.192, 0.142],
  [0.184, 0.162],
  [0.17, 0.189],
  [0.154, 0.22],
  [0.14, 0.253],
  [0.133, 0.284],
  [0.139, 0.313],
  [0.152, 0.334],
  [0.161, 0.35],
  [0.156, 0.368],
  [0.143, 0.388],
  [0.127, 0.414],
  [0.114, 0.442],
  [0.107, 0.47],
  [0.105, 0.494],
  [0.112, 0.522],
  [0.125, 0.55],
  [0.142, 0.58],
  [0.16, 0.615],
  [0.179, 0.654],
  [0.194, 0.696],
  [0.204, 0.738],
  [0.211, 0.78],
  [0.214, 0.815],
  [0.209, 0.848],
  [0.197, 0.878],
  [0.186, 0.9],
  [0.184, 0.918],
  // The crown cup is flared and lipped; eight appliqué points rise from it.
  [0.192, 0.933],
  [0.198, 0.947],
  [0.193, 0.959],
  [0.18, 0.971],
  [0.161, 0.982],
  [0.134, 0.991],
  [0.1, 0.998],
  [0.06, 1.003],
  [0.0, 1.006],
];

const KING_PROFILE: readonly Point2[] = [
  [0.197, 0.142],
  [0.189, 0.162],
  [0.175, 0.19],
  [0.16, 0.22],
  [0.148, 0.252],
  [0.141, 0.284],
  [0.147, 0.315],
  [0.161, 0.338],
  [0.166, 0.357],
  [0.154, 0.383],
  [0.142, 0.412],
  [0.132, 0.443],
  [0.128, 0.47],
  [0.132, 0.496],
  [0.141, 0.52],
  [0.155, 0.548],
  [0.172, 0.58],
  [0.189, 0.615],
  [0.204, 0.652],
  [0.216, 0.692],
  [0.223, 0.732],
  [0.226, 0.77],
  [0.223, 0.805],
  [0.214, 0.838],
  [0.201, 0.868],
  [0.19, 0.895],
  [0.186, 0.918],
  // Closed crown: a stepped rim, then a softly domed cap under the finial.
  [0.192, 0.938],
  [0.196, 0.952],
  [0.19, 0.966],
  [0.176, 0.981],
  [0.158, 0.996],
  [0.137, 1.012],
  [0.113, 1.03],
  [0.084, 1.047],
  [0.052, 1.061],
  [0.022, 1.072],
  [0.0, 1.08],
];

/**
 * Knight body: a slender turned stem that ends inside the sculpted head.
 * Unlike the other pieces the knight is not rotationally symmetric, so its
 * horse head is a separate mesh that is yawed toward the opponent per colour.
 */
const KNIGHT_PROFILE: readonly Point2[] = [
  [0.196, 0.142],
  [0.189, 0.16],
  [0.175, 0.184],
  [0.159, 0.212],
  [0.146, 0.243],
  [0.138, 0.275],
  [0.144, 0.303],
  [0.154, 0.326],
  [0.161, 0.345],
  [0.157, 0.364],
  [0.145, 0.384],
  [0.13, 0.405],
  [0.115, 0.43],
  [0.1, 0.456],
  [0.085, 0.48],
  [0.065, 0.5],
  [0.035, 0.518],
  [0.0, 0.524],
];

type MaterialSlot = 'body' | 'accent';

interface PiecePart {
  /** Stable key and scene-graph label for the part. */
  readonly name: string;
  readonly geometry: THREE.BufferGeometry;
  readonly slot: MaterialSlot;
  /** Knight head: yaw about the root so it faces the opponent. */
  readonly facing?: boolean;
}

interface PreparedPiece {
  readonly parts: readonly PiecePart[];
}

// ---------------------------------------------------------------------------
// Turning helpers
// ---------------------------------------------------------------------------

function makeProfile(extra: readonly Point2[]): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  for (const point of BASE_PROFILE) {
    points.push(new THREE.Vector2(point[0], point[1]));
  }
  for (const point of extra) {
    points.push(new THREE.Vector2(point[0], point[1]));
  }
  return points;
}

function makeLathe(extra: readonly Point2[]): THREE.BufferGeometry {
  return new THREE.LatheGeometry(makeProfile(extra), LATHE_SEGMENTS);
}

/**
 * A slim brass collar. The inner edge is deliberately sunk below the neck
 * radius, so the open back of the band can never be seen against the piece.
 */
function makeBand(
  neckRadius: number,
  bottomY: number,
  height: number,
  proud = 0.017,
): THREE.BufferGeometry {
  const inner = neckRadius - 0.014;
  const outer = neckRadius + proud;
  const chamfer = Math.min(height * 0.25, 0.0045);
  const points = [
    new THREE.Vector2(inner, bottomY),
    new THREE.Vector2(outer - chamfer, bottomY),
    new THREE.Vector2(outer, bottomY + chamfer),
    new THREE.Vector2(outer, bottomY + height - chamfer),
    new THREE.Vector2(outer - chamfer, bottomY + height),
    new THREE.Vector2(inner, bottomY + height),
  ];
  return new THREE.LatheGeometry(points, LATHE_SEGMENTS);
}

interface ExtrudeOptions {
  readonly depth: number;
  readonly bevel: number;
  readonly bevelSegments?: number;
  readonly curveSegments?: number;
}

/**
 * Extrude a 2D silhouette through the origin's Z axis. Our head, battlement
 * and crown silhouettes deliberately face +X in their own local space and get
 * yawed into place, which keeps the source curves easy to reason about.
 */
function makeExtrusion(
  shape: THREE.Shape,
  { depth, bevel, bevelSegments = 2, curveSegments = 4 }: ExtrudeOptions,
): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function placeGeometry(
  geometry: THREE.BufferGeometry,
  position: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  geometry.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  return geometry;
}

/**
 * Merge parts into one draw call. `mergeGeometries` requires the index state
 * to match across inputs (lathes and spheres are indexed; extrusions are not),
 * so normalise everything to non-indexed first. All primitives share the same
 * position/normal/uv attribute set, which keeps the merge lossless.
 */
function mergeStrict(geometries: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const normalized = geometries.map((geometry) =>
    geometry.index ? geometry.toNonIndexed() : geometry,
  );
  const merged = mergeGeometries(normalized, false);
  if (!merged) {
    throw new Error('ChessPiece: incompatible procedural geometry');
  }
  merged.computeBoundingSphere();
  return merged;
}

// ---------------------------------------------------------------------------
// Materials, shared by every piece
// ---------------------------------------------------------------------------

/**
 * Ivory is nearly dielectric: a faint sheen keeps the soft-touch mineral
 * surface alive, while a restrained clearcoat catches the warm key light.
 */
const IVORY_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0xe8ddc7,
  roughness: 0.32,
  metalness: 0.02,
  clearcoat: 0.45,
  clearcoatRoughness: 0.32,
  sheen: 0.25,
  sheenColor: 0xfff1dc,
  sheenRoughness: 0.7,
  specularIntensity: 0.55,
  envMapIntensity: 1,
});

/**
 * Onyx is deliberately slightly metallic, with a stronger, glossier coat. The
 * warm sheen is there to lift the silhouette in the dim, blue-shadowed end of
 * the scene without making the black pieces look grey.
 */
const ONYX_MATERIAL = new THREE.MeshPhysicalMaterial({
  // Lifted from near-black so the smoky form survives the dim atelier key,
  // while the strong coat and low metalness retain the obsidian character.
  color: 0x36302b,
  roughness: 0.23,
  metalness: 0.07,
  clearcoat: 1,
  clearcoatRoughness: 0.16,
  sheen: 0.4,
  sheenColor: 0x8a7258,
  sheenRoughness: 0.52,
  specularIntensity: 0.8,
  specularColor: 0xc9b394,
  envMapIntensity: 1.25,
});

/** Restrained warm brass; the white set gets a touch more brightness. */
const BRASS_LIGHT_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0xc3a36f,
  roughness: 0.3,
  metalness: 0.77,
  clearcoat: 0.25,
  clearcoatRoughness: 0.28,
  envMapIntensity: 1.15,
});

/** Antique brass for onyx; a shade deeper so it never reads as bright gold. */
const BRASS_DARK_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: 0xb08a52,
  roughness: 0.33,
  metalness: 0.74,
  clearcoat: 0.2,
  clearcoatRoughness: 0.3,
  envMapIntensity: 1.1,
});

const BODY_MATERIALS: Record<Color, THREE.MeshPhysicalMaterial> = {
  w: IVORY_MATERIAL,
  b: ONYX_MATERIAL,
};

const ACCENT_MATERIALS: Record<Color, THREE.MeshPhysicalMaterial> = {
  w: BRASS_LIGHT_MATERIAL,
  b: BRASS_DARK_MATERIAL,
};

// ---------------------------------------------------------------------------
// Pawn
// ---------------------------------------------------------------------------

/** Ivory pawn: turned stem, a thin neck and a polished sphere head. */
function buildPawn(): PreparedPiece {
  const bodyParts: THREE.BufferGeometry[] = [];

  bodyParts.push(makeLathe(PAWN_PROFILE));

  const head = new THREE.SphereGeometry(0.108, 32, 24);
  head.translate(0, 0.632, 0);
  bodyParts.push(head);

  return {
    parts: [
      { name: 'body', geometry: mergeStrict(bodyParts), slot: 'body' },
      { name: 'collar', geometry: makeBand(0.081, 0.489, 0.026), slot: 'accent' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Bishop
// ---------------------------------------------------------------------------

/**
 * Bishop: the bulbous lower head and narrow, sharply tapered mitre are cut in
 * one profile. A deep cove below the mitre plus two soft beads keep the
 * silhouette distinct from the taller queen.
 */
function buildBishop(): PreparedPiece {
  return {
    parts: [
      { name: 'body', geometry: makeLathe(BISHOP_PROFILE), slot: 'body' },
      { name: 'collar', geometry: makeBand(0.106, 0.458, 0.026), slot: 'accent' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Rook
// ---------------------------------------------------------------------------

/**
 * Rook: a flared, dished capital carries six chamfered merlons. The merlons
 * are merged into the body geometry, so a rook is still only two draw calls.
 */
function buildRook(): PreparedPiece {
  const bodyParts: THREE.BufferGeometry[] = [makeLathe(ROOK_PROFILE)];

  const merlonWidth = 0.158;
  const merlonHeight = 0.206;
  const merlon = new THREE.Shape();
  merlon.moveTo(-merlonWidth / 2, 0);
  merlon.lineTo(merlonWidth / 2, 0);
  merlon.lineTo(merlonWidth / 2, merlonHeight * 0.78);
  merlon.lineTo(merlonWidth * 0.38, merlonHeight);
  merlon.lineTo(-merlonWidth * 0.38, merlonHeight);
  merlon.lineTo(-merlonWidth / 2, merlonHeight * 0.78);
  merlon.closePath();

  const merlonGeometry = makeExtrusion(merlon, {
    depth: 0.074,
    bevel: 0.006,
    bevelSegments: 2,
  });

  const crownParts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2 + Math.PI / 6;
    const part = merlonGeometry.clone();
    placeGeometry(part, [Math.sin(angle) * 0.206, 0.708, Math.cos(angle) * 0.206], [0, angle, 0]);
    crownParts.push(part);
  }
  bodyParts.push(mergeStrict(crownParts));

  return {
    parts: [
      { name: 'body', geometry: mergeStrict(bodyParts), slot: 'body' },
      { name: 'collar', geometry: makeBand(0.171, 0.545, 0.028), slot: 'accent' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Queen
// ---------------------------------------------------------------------------

/**
 * Queen: a gracefully flared crown cup with eight appliqué points and a brass
 * finial orb. The orb tops out at 1.22, the queen's defining height.
 */
function buildQueen(): PreparedPiece {
  const bodyParts: THREE.BufferGeometry[] = [makeLathe(QUEEN_PROFILE)];

  // A petal silhouette, wider at its root than the tip, is extruded thin and
  // stood around the rim. Bevels give each point a turned, jewel-like edge.
  const point = new THREE.Shape();
  point.moveTo(-0.026, 0);
  point.quadraticCurveTo(-0.052, 0.025, -0.044, 0.058);
  point.quadraticCurveTo(-0.032, 0.1, 0, 0.158);
  point.quadraticCurveTo(0.032, 0.1, 0.044, 0.058);
  point.quadraticCurveTo(0.052, 0.025, 0.026, 0);
  point.closePath();

  const pointGeometry = makeExtrusion(point, {
    depth: 0.038,
    bevel: 0.005,
    bevelSegments: 1,
    curveSegments: 4,
  });

  const crownParts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    const part = pointGeometry.clone();
    placeGeometry(part, [Math.sin(angle) * 0.178, 0.955, Math.cos(angle) * 0.178], [0, angle, 0]);
    crownParts.push(part);
  }
  bodyParts.push(mergeStrict(crownParts));

  // Brass finial: a slim stem from the cup's center, a turned washer, and an
  // orb. All kept in one accent geometry so the crown remains one extra draw.
  const finialStem = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0, 0.995),
      new THREE.Vector2(0.036, 1.0),
      new THREE.Vector2(0.032, 1.03),
      new THREE.Vector2(0.024, 1.07),
      new THREE.Vector2(0.02, 1.115),
      new THREE.Vector2(0, 1.118),
    ],
    24,
  );
  const finialOrb = new THREE.SphereGeometry(0.05, 24, 16);
  finialOrb.translate(0, 1.17, 0);

  const accent = mergeStrict([
    makeBand(0.106, 0.472, 0.026),
    finialStem,
    finialOrb,
  ]);

  return {
    parts: [
      { name: 'body', geometry: mergeStrict(bodyParts), slot: 'body' },
      { name: 'crown', geometry: accent, slot: 'accent' },
    ],
  };
}

// ---------------------------------------------------------------------------
// King
// ---------------------------------------------------------------------------

/**
 * King: the tallest turning in the set. Its crown is closed under a domed cap,
 * with a brass knop and a beveled Latin cross forming the unmistakable finial.
 */
function buildKing(): PreparedPiece {
  const body = makeLathe(KING_PROFILE);

  const cross = new THREE.Shape();
  const barHalf = 0.018;
  const armHalf = 0.075;
  const armBottom = 0.15;
  const armThickness = 0.034;
  const crossTop = 0.264;
  cross.moveTo(-barHalf, 0);
  cross.lineTo(barHalf, 0);
  cross.lineTo(barHalf, armBottom);
  cross.lineTo(armHalf, armBottom);
  cross.lineTo(armHalf, armBottom + armThickness);
  cross.lineTo(barHalf, armBottom + armThickness);
  cross.lineTo(barHalf, crossTop);
  cross.lineTo(-barHalf, crossTop);
  cross.lineTo(-barHalf, armBottom + armThickness);
  cross.lineTo(-armHalf, armBottom + armThickness);
  cross.lineTo(-armHalf, armBottom);
  cross.lineTo(-barHalf, armBottom);
  cross.closePath();

  const crossGeometry = makeExtrusion(cross, {
    depth: 0.034,
    bevel: 0.006,
    bevelSegments: 3,
  });
  // Shape bottom at 1.07 plus the 0.270 beveled height tops out at 1.34.
  crossGeometry.translate(0, 1.07, 0);

  // A squashed bead hides the junction between dome and cross; the cross
  // remains the dominant vertical accent.
  const knop = new THREE.SphereGeometry(1, 24, 16);
  knop.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(0, 1.078, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(0.05, 0.036, 0.05),
    ),
  );

  const accent = mergeStrict([
    makeBand(0.132, 0.496, 0.026),
    crossGeometry,
    knop,
  ]);

  return {
    parts: [
      { name: 'body', geometry: body, slot: 'body' },
      { name: 'crown', geometry: accent, slot: 'accent' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Knight
// ---------------------------------------------------------------------------

const KNIGHT_HEAD_Y = 0.39;
// Short, broad, horse-like ears. A narrower ear would read as a rabbit's.
const KNIGHT_EAR_PROFILE: readonly Point2[] = [
  [0, 0],
  [0.021, 0.005],
  [0.036, 0.018],
  [0.04, 0.045],
  [0.034, 0.08],
  [0.018, 0.108],
  [0, 0.14],
];

/**
 * Horse head silhouette in the XY plane, facing +X. The neck is kept slender
 * and nearly upright, like the carved knights in an atelier set; the face then
 * projects forward on a long diagonal, ending in a low, blunt muzzle. A deep
 * concave throat and a small jaw notch stop the silhouette from reading as a
 * round finial.
 */
function makeKnightHeadShape(): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-0.07, 0);
  shape.bezierCurveTo(-0.1, 0.045, -0.11, 0.13, -0.1, 0.22);
  shape.bezierCurveTo(-0.09, 0.31, -0.06, 0.39, -0.015, 0.435);
  shape.quadraticCurveTo(0.02, 0.462, 0.068, 0.455);
  shape.quadraticCurveTo(0.122, 0.442, 0.158, 0.404);
  shape.bezierCurveTo(0.21, 0.35, 0.26, 0.28, 0.295, 0.21);
  shape.quadraticCurveTo(0.325, 0.16, 0.335, 0.13);
  // Low muzzle with a rounded nose, a jaw notch and a deeply scooped throat.
  shape.quadraticCurveTo(0.337, 0.11, 0.315, 0.1);
  shape.quadraticCurveTo(0.285, 0.09, 0.258, 0.088);
  shape.quadraticCurveTo(0.235, 0.086, 0.218, 0.102);
  shape.quadraticCurveTo(0.165, 0.075, 0.128, 0.038);
  shape.quadraticCurveTo(0.098, 0.012, 0.07, 0);
  shape.closePath();
  return shape;
}

/**
 * A narrow center crest follows the back of the neck with three soft mane
 * undulations. It is deliberately thinner than the head so it reads as a
 * carved ridge in silhouette instead of a saw-tooth fin.
 */
function makeKnightManeShape(): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0.008, 0.44);
  shape.quadraticCurveTo(-0.04, 0.42, -0.075, 0.38);
  shape.quadraticCurveTo(-0.1, 0.33, -0.108, 0.268);
  shape.quadraticCurveTo(-0.122, 0.284, -0.128, 0.27);
  shape.quadraticCurveTo(-0.118, 0.244, -0.11, 0.23);
  shape.quadraticCurveTo(-0.123, 0.208, -0.125, 0.192);
  shape.quadraticCurveTo(-0.11, 0.17, -0.098, 0.155);
  shape.quadraticCurveTo(-0.111, 0.128, -0.104, 0.108);
  shape.quadraticCurveTo(-0.094, 0.084, -0.077, 0.063);
  shape.quadraticCurveTo(-0.066, 0.035, -0.052, 0.024);
  // Inner edge, running back up against the neck.
  shape.quadraticCurveTo(-0.064, 0.06, -0.073, 0.1);
  shape.quadraticCurveTo(-0.085, 0.16, -0.088, 0.22);
  shape.quadraticCurveTo(-0.078, 0.31, -0.05, 0.38);
  shape.quadraticCurveTo(-0.022, 0.415, 0.008, 0.44);
  shape.closePath();
  return shape;
}

function makeKnightEar(
  x: number,
  z: number,
  tiltX: number,
  tiltZ: number,
): THREE.BufferGeometry {
  const ear = new THREE.LatheGeometry(
    KNIGHT_EAR_PROFILE.map((point) => new THREE.Vector2(point[0], point[1])),
    20,
  );
  placeGeometry(
    ear,
    [x, KNIGHT_HEAD_Y + 0.456, z],
    [tiltX, 0, tiltZ],
  );
  return ear;
}

/**
 * Knight: a turned pedestal and a beveled horse-head sculpture. The head faces
 * +X locally and is rotated about the root at render time; white faces -Z and
 * black faces +Z, following chess convention. Ears and mane are merged into
 * the head geometry so a knight costs three draw calls at most.
 */
function buildKnight(): PreparedPiece {
  const head = makeExtrusion(makeKnightHeadShape(), {
    // A slim head reads more like a horse than a wide slab and leaves room in
    // the XZ footprint for the long muzzle.
    depth: 0.14,
    bevel: 0.016,
    bevelSegments: 3,
    curveSegments: 10,
  });
  head.translate(0, KNIGHT_HEAD_Y, 0);

  const mane = makeExtrusion(makeKnightManeShape(), {
    depth: 0.055,
    bevel: 0.008,
    bevelSegments: 2,
    curveSegments: 6,
  });
  mane.translate(0, KNIGHT_HEAD_Y, 0);

  const headGeometry = mergeStrict([
    head,
    mane,
    // Staggered ears: one sits just behind the other so both tips read from a
    // side or three-quarter view instead of collapsing into a single horn.
    makeKnightEar(0.015, 0.062, 0.22, 0.24),
    makeKnightEar(0.072, -0.062, -0.22, 0.1),
  ]);
  // Pull the whole head assembly back a hair so the nose overhang and plinth
  // share the same footprint envelope.
  headGeometry.translate(-0.025, 0, 0);

  return {
    parts: [
      { name: 'body', geometry: makeLathe(KNIGHT_PROFILE), slot: 'body' },
      { name: 'head', geometry: headGeometry, slot: 'body', facing: true },
      { name: 'collar', geometry: makeBand(0.148, 0.35, 0.028), slot: 'accent' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Prepared set
// ---------------------------------------------------------------------------

const PIECE_ASSETS: Record<PieceType, PreparedPiece> = {
  p: buildPawn(),
  n: buildKnight(),
  b: buildBishop(),
  r: buildRook(),
  q: buildQueen(),
  k: buildKing(),
};

/**
 * Knight yaw. In three, rotating a +X-facing shape by +90 degrees about Y maps
 * it to -Z. White knights therefore face the black side at -Z; black knights
 * are turned to +Z.
 */
const FACING_ROTATION: Record<Color, Vec3> = {
  w: [0, Math.PI / 2, 0],
  b: [0, -Math.PI / 2, 0],
};

/**
 * One piece at the origin. The parent positions and animates the root group;
 * this component deliberately applies no positional offset of its own.
 */
export function ChessPiece({ type, color }: { type: PieceType; color: Color }): React.JSX.Element {
  const piece = PIECE_ASSETS[type];
  const bodyMaterial = BODY_MATERIALS[color];
  const accentMaterial = ACCENT_MATERIALS[color];

  return (
    <group name={`piece-${color}-${type}`}>
      {piece.parts.map((part) => (
        <mesh
          key={part.name}
          name={part.name}
          geometry={part.geometry}
          material={part.slot === 'accent' ? accentMaterial : bodyMaterial}
          rotation={part.facing ? FACING_ROTATION[color] : undefined}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}
