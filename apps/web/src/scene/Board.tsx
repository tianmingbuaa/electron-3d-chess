import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { PieceLayer } from './PieceLayer';
import * as THREE from 'three';
import type { Square } from '@nocturne/chess-shared';
import { FILES, RANKS } from '@nocturne/chess-shared';
import { canHumanMove, useGameStore } from '../store/gameStore';
import {
  FRAME_HALF,
  isDarkSquare,
  squareAt,
  squareToBoardPosition,
} from './boardMath';

const TILE_DEPTH = 0.05;
const TILE_TOP = 0.006;
/* -------------------------------------------------------------------------- */
/*                             Procedural materials                           */
/* -------------------------------------------------------------------------- */

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0xffffffff;
  };
}

function createCanvasTexture(
  draw: (context: CanvasRenderingContext2D, size: number) => void,
  size = 512,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is unavailable');
  draw(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function drawWood(): THREE.CanvasTexture {
  return createCanvasTexture((ctx, size) => {
    const random = seeded(19);
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, '#b7a088');
    gradient.addColorStop(0.5, '#c7b49d');
    gradient.addColorStop(1, '#a68d74');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.lineCap = 'round';
    for (let i = 0; i < 92; i += 1) {
      const offset = random() * size;
      const amplitude = 2 + random() * 11;
      const frequency = 0.006 + random() * 0.014;
      ctx.beginPath();
      for (let x = -10; x <= size + 10; x += 6) {
        const y = offset + Math.sin(x * frequency + random() * 0.06) * amplitude;
        if (x === -10) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(64, 43, 29, ${0.025 + random() * 0.07})`;
      ctx.lineWidth = 0.5 + random() * 2.3;
      ctx.stroke();
    }

    for (let i = 0; i < 4500; i += 1) {
      ctx.fillStyle = `rgba(255, 240, 215, ${random() * 0.02})`;
      ctx.fillRect(random() * size, random() * size, 1, 1);
    }
  }, 512);
}

function drawMarble(): THREE.CanvasTexture {
  return createCanvasTexture((ctx, size) => {
    const random = seeded(47);
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, '#f2e9d8');
    gradient.addColorStop(0.55, '#e9ddca');
    gradient.addColorStop(1, '#f4ecdc');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 12; i += 1) {
      ctx.beginPath();
      const startX = random() * size;
      const startY = random() * size;
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(
        startX + 80 + random() * 90,
        startY - 40 + random() * 80,
        startX + 180 + random() * 140,
        startY + 50 - random() * 120,
        startX + 360,
        startY + (random() - 0.5) * 180,
      );
      ctx.strokeStyle = 'rgba(88, 72, 55, 0.32)';
      ctx.lineWidth = 1 + random() * 3;
      ctx.stroke();
    }

    ctx.globalAlpha = 0.055;
    for (let i = 0; i < 22; i += 1) {
      ctx.beginPath();
      const y = random() * size;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + 30, size * 0.6, y - 40, size, y + 20);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2 + random() * 5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, 512);
}

const woodTexture = drawWood();
const marbleTexture = drawMarble();

function makeTileGeometry(): THREE.ExtrudeGeometry {
  const half = 0.482;
  const radius = 0.038;
  const shape = new THREE.Shape();
  shape.moveTo(-half + radius, -half);
  shape.lineTo(half - radius, -half);
  shape.quadraticCurveTo(half, -half, half, -half + radius);
  shape.lineTo(half, half - radius);
  shape.quadraticCurveTo(half, half, half - radius, half);
  shape.lineTo(-half + radius, half);
  shape.quadraticCurveTo(-half, half, -half, half - radius);
  shape.lineTo(-half, -half + radius);
  shape.quadraticCurveTo(-half, -half, -half + radius, -half);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: TILE_DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.007,
    bevelSegments: 2,
    curveSegments: 5,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

const tileGeometry = makeTileGeometry();

/* -------------------------------------------------------------------------- */
/*                                Canvas labels                               */
/* -------------------------------------------------------------------------- */

const labelCache = new Map<string, THREE.CanvasTexture>();

function getLabelTexture(label: string, inverted = false): THREE.CanvasTexture {
  const key = `${label}-${inverted ? 'i' : 'n'}`;
  const cached = labelCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  ctx.translate(64, 64);
  if (inverted) ctx.rotate(Math.PI);
  ctx.fillStyle = '#e6d1ad';
  ctx.font = 'italic 500 66px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 8;
  ctx.fillText(label, 0, 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  labelCache.set(key, texture);
  return texture;
}

function makePlaqueTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  ctx.strokeStyle = 'rgba(220, 193, 149, 0.42)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(80, 80);
  ctx.lineTo(330, 80);
  ctx.moveTo(694, 80);
  ctx.lineTo(944, 80);
  ctx.stroke();
  ctx.fillStyle = 'rgba(232, 210, 171, 0.86)';
  ctx.font = '500 48px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N O C T U R N E', 512, 78);
  ctx.fillStyle = 'rgba(219, 185, 134, 0.72)';
  ctx.font = '26px Georgia, serif';
  ctx.fillText('◇', 512, 118);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const plaqueTexture = makePlaqueTexture();

function Label({
  label,
  x,
  z,
  inverted,
}: {
  label: string;
  x: number;
  z: number;
  inverted: boolean;
}) {
  return (
    <mesh
      position={[x, -0.016, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => null}
    >
      <planeGeometry args={[0.23, 0.23]} />
      <meshBasicMaterial
        map={getLabelTexture(label, inverted)}
        transparent
        opacity={0.82}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Board                                    */
/* -------------------------------------------------------------------------- */

function BoardFrame() {
  const clearSelection = useGameStore((state) => state.clearSelection);
  const handleClick = (event: { stopPropagation(): void }): void => {
    event.stopPropagation();
    clearSelection();
  };

  return (
    <group>
      <RoundedBox
        args={[9.3, 0.27, 9.3]}
        radius={0.12}
        smoothness={4}
        position={[0, -0.165, 0]}
        castShadow
        receiveShadow
        onClick={handleClick}
      >
        <meshPhysicalMaterial
          map={woodTexture}
          color="#553f31"
          roughness={0.43}
          metalness={0.1}
          clearcoat={0.35}
          clearcoatRoughness={0.34}
        />
      </RoundedBox>

      <RoundedBox
        args={[9.66, 0.18, 9.66]}
        radius={0.1}
        smoothness={4}
        position={[0, -0.39, 0]}
        castShadow
        receiveShadow
        onClick={handleClick}
      >
        <meshPhysicalMaterial
          color="#1d1713"
          roughness={0.5}
          metalness={0.18}
          clearcoat={0.28}
          clearcoatRoughness={0.5}
        />
      </RoundedBox>

      {/* Brass pinstripe around the recessed playing surface. */}
      {[
        [0, -0.022, 4.055, 8.26, 0.018, 0.023],
        [0, -0.022, -4.055, 8.26, 0.018, 0.023],
        [4.055, -0.022, 0, 0.023, 0.018, 8.26],
        [-4.055, -0.022, 0, 0.023, 0.018, 8.26],
      ].map(([x, y, z, w, h, d], index) => (
        <mesh
          key={`inlay-${index}`}
          position={[x ?? 0, y ?? 0, z ?? 0]}
          raycast={() => null}
        >
          <boxGeometry args={[w ?? 0, h ?? 0, d ?? 0]} />
          <meshPhysicalMaterial
            color="#b6935c"
            metalness={0.92}
            roughness={0.28}
            clearcoat={0.7}
          />
        </mesh>
      ))}

      {/* Slim brass line where the upper plinth meets the lower base. */}
      {[
        [0, -0.307, 4.66, 9.34, 0.012, 0.018],
        [0, -0.307, -4.66, 9.34, 0.012, 0.018],
        [4.66, -0.307, 0, 0.018, 0.012, 9.34],
        [-4.66, -0.307, 0, 0.018, 0.012, 9.34],
      ].map(([x, y, z, w, h, d], index) => (
        <mesh
          key={`trim-${index}`}
          position={[x ?? 0, y ?? 0, z ?? 0]}
          raycast={() => null}
        >
          <boxGeometry args={[w ?? 0, h ?? 0, d ?? 0]} />
          <meshPhysicalMaterial color="#9d7d4d" metalness={0.85} roughness={0.35} />
        </mesh>
      ))}

      {[
        [-4.3, -4.3],
        [4.3, -4.3],
        [-4.3, 4.3],
        [4.3, 4.3],
      ].map(([x, z], index) => (
        <group key={`stud-${index}`} position={[x ?? 0, -0.014, z ?? 0]}>
          <mesh raycast={() => null}>
            <cylinderGeometry args={[0.055, 0.065, 0.012, 20]} />
            <meshPhysicalMaterial color="#b89a68" metalness={0.9} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.007, 0]} raycast={() => null}>
            <cylinderGeometry args={[0.022, 0.022, 0.006, 16]} />
            <meshBasicMaterial color="#f0d6a5" toneMapped={false} />
          </mesh>
        </group>
      ))}

      {[
        [-4.12, -4.12],
        [4.12, -4.12],
        [-4.12, 4.12],
        [4.12, 4.12],
      ].map(([x, z], index) => (
        <mesh
          key={`foot-${index}`}
          position={[x ?? 0, -0.545, z ?? 0]}
          castShadow
          raycast={() => null}
        >
          <cylinderGeometry args={[0.13, 0.17, 0.13, 24]} />
          <meshPhysicalMaterial color="#2b2119" metalness={0.5} roughness={0.36} />
        </mesh>
      ))}

      {FILES.map((file, index) => (
        <group key={`coords-${file}`}>
          <Label label={file} x={index - 3.5} z={4.29} inverted={false} />
          <Label label={file} x={index - 3.5} z={-4.29} inverted />
        </group>
      ))}
      {RANKS.map((rank, index) => (
        <group key={`rank-${rank}`}>
          <Label label={rank} x={-4.29} z={3.5 - index} inverted={false} />
          <Label label={rank} x={4.29} z={3.5 - index} inverted />
        </group>
      ))}

      <mesh position={[0, -0.2, FRAME_HALF + 0.008]} raycast={() => null}>
        <planeGeometry args={[2.35, 0.35]} />
        <meshBasicMaterial map={plaqueTexture} transparent opacity={0.82} toneMapped={false} />
      </mesh>
      <mesh
        position={[0, -0.2, -FRAME_HALF - 0.008]}
        rotation={[0, Math.PI, 0]}
        raycast={() => null}
      >
        <planeGeometry args={[2.35, 0.35]} />
        <meshBasicMaterial map={plaqueTexture} transparent opacity={0.82} toneMapped={false} />
      </mesh>
    </group>
  );
}

interface TileProps {
  square: Square;
  canMove: boolean;
  onHover(square: Square | null): void;
}

function Tile({ square, canMove, onHover }: TileProps) {
  const selectSquare = useGameStore((state) => state.selectSquare);
  const dark = isDarkSquare(square);
  const { x, z } = squareToBoardPosition(square);

  const cursor = (): void => {
    document.body.style.cursor = canMove ? 'pointer' : 'default';
  };

  return (
    <mesh
      geometry={tileGeometry}
      position={[x, -TILE_DEPTH + TILE_TOP, z]}
      receiveShadow
      onClick={(event) => {
        if (event.delta > 6) return;
        event.stopPropagation();
        selectSquare(square);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(square);
        cursor();
      }}
      onPointerOut={() => {
        onHover(null);
        document.body.style.cursor = 'default';
      }}
    >
      <meshPhysicalMaterial
        map={dark ? woodTexture : marbleTexture}
        color={dark ? '#684f3c' : '#dbc9ab'}
        roughness={dark ? 0.44 : 0.5}
        metalness={dark ? 0.08 : 0.01}
        clearcoat={0.24}
        clearcoatRoughness={0.38}
        reflectivity={0.32}
      />
    </mesh>
  );
}

function BoardTiles({
  hovered,
  onHover,
  canMove,
}: {
  hovered: Square | null;
  onHover(square: Square | null): void;
  canMove: boolean;
}) {
  return (
    <group>
      {RANKS.map((_, rankIndex) =>
        FILES.map((__, fileIndex) => {
          const square = squareAt(fileIndex, rankIndex);
          return (
            <Tile key={square} square={square} canMove={canMove} onHover={onHover} />
          );
        }),
      )}
      {hovered && (
        <mesh
          position={[
            squareToBoardPosition(hovered).x,
            TILE_TOP + 0.004,
            squareToBoardPosition(hovered).z,
          ]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <planeGeometry args={[0.94, 0.94]} />
          <meshBasicMaterial
            color="#f6dfb2"
            transparent
            opacity={0.055}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

function SquareFill({
  square,
  color,
  opacity,
}: {
  square: Square;
  color: string;
  opacity: number;
}) {
  const { x, z } = squareToBoardPosition(square);
  return (
    <mesh
      position={[x, TILE_TOP + 0.006, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => null}
    >
      <planeGeometry args={[0.96, 0.96]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function SelectedOutline({ square }: { square: Square }) {
  const { x, z } = squareToBoardPosition(square);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.opacity = 0.78 + Math.sin(clock.elapsedTime * 2.4) * 0.14;
    }
  });
  const y = TILE_TOP + 0.018;
  const bars: Array<[number, number, number]> = [
    [x, y, z - 0.474],
    [x, y, z + 0.474],
    [x - 0.474, y, z],
    [x + 0.474, y, z],
  ];
  return (
    <group>
      {bars.map(([bx, by, bz], index) => (
        <mesh key={index} position={[bx, by, bz]} raycast={() => null}>
          <boxGeometry args={index < 2 ? [0.955, 0.01, 0.024] : [0.024, 0.01, 0.955]} />
          <meshBasicMaterial
            ref={index === 0 ? materialRef : undefined}
            color="#ecc286"
            transparent
            opacity={0.86}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function LegalMarker({ square, capture }: { square: Square; capture: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const { x, z } = squareToBoardPosition(square);
  useEffect(() => {
    groupRef.current?.scale.setScalar(0.01);
  }, []);
  useFrame(({ clock }, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 3.1) * (capture ? 0.045 : 0.07);
    const scale = THREE.MathUtils.damp(group.scale.x, pulse, 12, delta);
    group.scale.setScalar(scale);
  });
  return (
    <group ref={groupRef} position={[x, TILE_TOP + 0.015, z]}>
      {capture ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[0.285, 0.345, 48]} />
          <meshBasicMaterial
            color="#efc88f"
            transparent
            opacity={0.85}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ) : (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
            <circleGeometry args={[0.12, 32]} />
            <meshBasicMaterial
              color="#f3ce98"
              transparent
              opacity={0.96}
              depthWrite={false}
              toneMapped={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} raycast={() => null}>
            <circleGeometry args={[0.205, 32]} />
            <meshBasicMaterial
              color="#e4b778"
              transparent
              opacity={0.14}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
            <ringGeometry args={[0.2, 0.22, 40]} />
            <meshBasicMaterial
              color="#f0c88f"
              transparent
              opacity={0.3}
              depthWrite={false}
              toneMapped={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </>
      )}
    </group>
  );
}

function CheckMarker({ square }: { square: Square }) {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const { x, z } = squareToBoardPosition(square);
  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.opacity = 0.2 + (Math.sin(clock.elapsedTime * 3.8) + 1) * 0.09;
    }
  });
  return (
    <mesh
      position={[x, TILE_TOP + 0.007, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => null}
    >
      <planeGeometry args={[0.96, 0.96]} />
      <meshBasicMaterial
        ref={materialRef}
        color="#c84f42"
        transparent
        opacity={0.25}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function BoardMarkers({ hovered }: { hovered: Square | null }) {
  const game = useGameStore((state) => state.game);
  const selected = useGameStore((state) => state.selected);

  if (!game) return null;

  const isHumanTurn = canHumanMove(game);
  const targets = selected ? game.legalMoves[selected] ?? [] : [];
  const occupied = new Set(game.pieces.map((piece) => piece.square));
  const lastMove = game.lastMove;

  return (
    <group>
      {lastMove && (
        <>
          <SquareFill square={lastMove.from} color="#ddba82" opacity={0.075} />
          <SquareFill square={lastMove.to} color="#e3be84" opacity={0.12} />
        </>
      )}
      {selected && (
        <>
          <SquareFill square={selected} color="#f1d09b" opacity={0.18} />
          <SelectedOutline square={selected} />
        </>
      )}
      {isHumanTurn &&
        selected &&
        targets.map((square) => (
          <LegalMarker key={square} square={square} capture={occupied.has(square)} />
        ))}
      {game.inCheck && game.checkSquare && <CheckMarker square={game.checkSquare} />}
      {hovered && isHumanTurn && selected && targets.includes(hovered) && (
        <SquareFill square={hovered} color="#ffe4b8" opacity={0.08} />
      )}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Animated board rig                            */
/* -------------------------------------------------------------------------- */

function BoardRig({ children }: { children: ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  const orientation = useGameStore((state) => state.orientation);
  const target = orientation === 'w' ? 0 : Math.PI;
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y = THREE.MathUtils.damp(
      groupRef.current.rotation.y,
      target,
      6.5,
      delta,
    );
  });
  return <group ref={groupRef}>{children}</group>;
}

export function ChessBoard() {
  const selected = useGameStore((state) => state.selected);
  const game = useGameStore((state) => state.game);
  const [hovered, setHovered] = useState<Square | null>(null);
  const targets = selected && game ? game.legalMoves[selected] ?? [] : [];
  const canMove = canHumanMove(game);

  useEffect(
    () => () => {
      document.body.style.cursor = 'default';
    },
    [],
  );

  return (
    <group>
      <BoardRig>
        <BoardFrame />
        <BoardTiles
          hovered={hovered}
          onHover={setHovered}
          canMove={canMove}
        />
        <BoardMarkers hovered={hovered} />
        <PieceLayer onHover={setHovered} />
      </BoardRig>
    </group>
  );
}

