import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PieceState, Square } from '@nocturne/chess-shared';
import { canHumanMove, useGameStore } from '../store/gameStore';
import { PIECE_BASE_Y, squareToBoardPosition } from './boardMath';
import { ChessPiece } from './PieceSet';

const MOVE_DURATION = 0.36;
const ARC_HEIGHT = 0.13;

interface AnimatedPieceProps {
  piece: PieceState;
  selected: boolean;
  canMove: boolean;
  onHover(square: Square | null): void;
}

function AnimatedPiece({ piece, selected, canMove, onHover }: AnimatedPieceProps) {
  const selectSquare = useGameStore((state) => state.selectSquare);
  const target = squareToBoardPosition(piece.square);
  const groupRef = useRef<THREE.Group>(null);
  const fromRef = useRef({ x: target.x, z: target.z });
  const progressRef = useRef(1);
  const previousSquare = useRef(piece.square);
  const initialPosition = useRef<[number, number, number]>([
    target.x,
    PIECE_BASE_Y,
    target.z,
  ]);

  useEffect(() => {
    if (previousSquare.current === piece.square) return;
    previousSquare.current = piece.square;
    const group = groupRef.current;
    if (group) {
      fromRef.current = { x: group.position.x, z: group.position.z };
      progressRef.current = 0;
    }
  }, [piece.square]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    if (progressRef.current < 1) {
      progressRef.current = Math.min(1, progressRef.current + delta / MOVE_DURATION);
      const t = progressRef.current;
      const eased = t * t * (3 - 2 * t);
      group.position.x = THREE.MathUtils.lerp(fromRef.current.x, target.x, eased);
      group.position.z = THREE.MathUtils.lerp(fromRef.current.z, target.z, eased);
      group.position.y = PIECE_BASE_Y + Math.sin(t * Math.PI) * ARC_HEIGHT;
      if (t >= 1) group.position.y = PIECE_BASE_Y;
    }

    const targetScale = selected ? 1.038 : 1;
    const scale = THREE.MathUtils.damp(group.scale.x, targetScale, 11, delta);
    group.scale.setScalar(scale);
  });

  return (
    <group
      ref={groupRef}
      position={initialPosition.current}
      onClick={(event) => {
        if (event.delta > 6) return;
        event.stopPropagation();
        selectSquare(piece.square);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(piece.square);
        document.body.style.cursor = canMove ? 'pointer' : 'default';
      }}
      onPointerOut={() => {
        onHover(null);
        document.body.style.cursor = 'default';
      }}
    >
      <ChessPiece type={piece.type} color={piece.color} />
    </group>
  );
}

function CaptureFlash({
  square,
  index,
}: {
  square: Square;
  index: number;
}) {
  const { x, z } = squareToBoardPosition(square);
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    elapsed.current += delta;
    const t = Math.min(1, elapsed.current / 0.7);
    if (groupRef.current) {
      groupRef.current.scale.setScalar(0.6 + t * 1.35);
      groupRef.current.position.y = 0.08 + Math.sin(t * Math.PI) * 0.16;
    }
    if (materialRef.current) materialRef.current.opacity = (1 - t) * 0.55;
  });

  return (
    <group key={index} ref={groupRef} position={[x, 0.08, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[0.16, 0.21, 36]} />
        <meshBasicMaterial
          ref={materialRef}
          color="#efd0a0"
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} raycast={() => null}>
        <circleGeometry args={[0.22, 28]} />
        <meshBasicMaterial
          color="#d7a765"
          transparent
          opacity={0.16}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export function PieceLayer({ onHover }: { onHover(square: Square | null): void }) {
  const game = useGameStore((state) => state.game);
  const selected = useGameStore((state) => state.selected);
  const canMove = canHumanMove(game);

  if (!game) return null;

  const lastMove = game.lastMove;

  return (
    <group>
      {game.pieces.map((piece) => (
        <AnimatedPiece
          key={`${piece.id}-${piece.type}`}
          piece={piece}
          selected={selected === piece.square}
          canMove={canMove}
          onHover={onHover}
        />
      ))}
      {lastMove?.capturedPiece && (
        <CaptureFlash
          key={`capture-${lastMove.index}`}
          square={lastMove.capturedPiece.square}
          index={lastMove.index}
        />
      )}
    </group>
  );
}

