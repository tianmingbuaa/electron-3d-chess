import { Suspense, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
  Sparkles,
} from '@react-three/drei';
import * as THREE from 'three';
import type { Square } from '@nocturne/chess-shared';
import { useGameStore } from '../store/gameStore';
import { squareToBoardPosition } from './boardMath';
import { ChessBoard } from './Board';
import { SceneErrorBoundary } from './SceneFallback';

/**
 * Frames the board for wide desktop windows as well as narrow, portrait
 * windows. The first layout chooses a distance/fov pair that keeps all 64
 * squares inside the horizontal field of view; users can still orbit/zoom.
 */
function FramingCamera() {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const framed = useRef(false);

  useEffect(() => {
    if (framed.current || size.width === 0 || size.height === 0) return;
    framed.current = true;
    const aspect = size.width / size.height;
    let position: [number, number, number];
    let fov: number;

    if (aspect < 0.72) {
      position = [7.6, 16.5, 19.3];
      fov = 46;
    } else if (aspect < 1.05) {
      position = [6.8, 13.0, 15.2];
      fov = 40;
    } else {
      position = [5.9, 10.9, 12.9];
      fov = 38;
    }

    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as THREE.PerspectiveCamera;
      perspective.fov = fov;
      perspective.position.set(...position);
      perspective.lookAt(-0.35, -0.5, 0);
      perspective.updateProjectionMatrix();
    }
  }, [camera, size.height, size.width]);

  return null;
}

function SceneLighting() {
  return (
    <>
      <ambientLight intensity={0.62} color="#f8e7ca" />
      <hemisphereLight args={['#f8dfb8', '#111821', 0.72]} />
      <directionalLight
        position={[6.5, 10.5, 7.5]}
        intensity={3.0}
        color="#ffe2b7"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-camera-near={0.5}
        shadow-camera-far={32}
        shadow-bias={-0.00025}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-7, 6, -5]} intensity={1.5} color="#a8c0e2" />
      <pointLight
        position={[-4.5, 2.6, 5.5]}
        intensity={22}
        distance={12}
        decay={2}
        color="#e4ad6b"
      />
      <spotLight
        position={[0, 12, -2]}
        angle={0.38}
        penumbra={0.9}
        intensity={42}
        distance={24}
        color="#f6ddb5"
      />
      <Environment resolution={192} frames={1}>
        <Lightformer
          form="rect"
          intensity={2.1}
          color="#f8dfb6"
          position={[0, 6, 3]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[9, 5, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.85}
          color="#98b1d4"
          position={[-7, 3, -5]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[6, 4, 1]}
        />
        <Lightformer
          form="circle"
          intensity={1.5}
          color="#efc58f"
          position={[6, 3, 4]}
          scale={3.5}
        />
        <Lightformer
          form="rect"
          intensity={0.6}
          color="#f5e9d4"
          position={[0, -2, -7]}
          rotation={[0, 0, 0]}
          scale={[8, 4, 1]}
        />
      </Environment>
    </>
  );
}

function DebugProjector() {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const orientation = useGameStore((state) => state.orientation);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return undefined;
    const angle = orientation === 'w' ? 0 : Math.PI;
    const axis = new THREE.Vector3(0, 1, 0);
    const target = window as unknown as {
      __NOCTURNE_PROJECT_SQUARE__?: (square: Square) => { x: number; y: number };
    };
    target.__NOCTURNE_PROJECT_SQUARE__ = (square: Square) => {
      const local = squareToBoardPosition(square);
      const point = new THREE.Vector3(local.x, 0.18, local.z).applyAxisAngle(axis, angle);
      point.project(camera);
      const rect = gl.domElement.getBoundingClientRect();
      return {
        x: rect.left + ((point.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - point.y) / 2) * rect.height,
      };
    };
    return () => {
      delete target.__NOCTURNE_PROJECT_SQUARE__;
    };
  }, [camera, gl, orientation]);

  return null;
}

function SceneContent() {
  return (
    <>
      <DebugProjector />
      <FramingCamera />
      <SceneLighting />
      <OrbitControls
        makeDefault
        target={[-0.35, -0.5, 0]}
        enablePan={false}
        enableDamping
        dampingFactor={0.055}
        rotateSpeed={0.45}
        zoomSpeed={0.65}
        minDistance={10}
        maxDistance={30}
        minPolarAngle={0.48}
        maxPolarAngle={1.34}
        minAzimuthAngle={-0.6}
        maxAzimuthAngle={0.6}
      />
      <ChessBoard />
      <ContactShadows
        position={[0, -0.61, 0]}
        opacity={0.66}
        scale={16}
        blur={2.3}
        far={4.2}
        resolution={512}
        color="#000000"
        frames={1}
      />
      <Sparkles
        count={34}
        scale={[10.5, 3.2, 10.5]}
        position={[0, 2.3, 0]}
        size={1.1}
        speed={0.12}
        opacity={0.2}
        color="#eac48e"
        noise={0.5}
      />
    </>
  );
}

export function ChessScene() {
  const clearSelection = useGameStore((state) => state.clearSelection);

  return (
    <SceneErrorBoundary>
      <Canvas
        className="chess-canvas"
        shadows="percentage"
        dpr={[1, 1.75]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          stencil: false,
          preserveDrawingBuffer: false,
        }}
        camera={{ position: [5.9, 10.9, 12.9], fov: 38, near: 0.1, far: 90 }}
        performance={{ min: 0.65 }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.17;
        }}
        onPointerMissed={() => clearSelection()}
      >
        <Suspense fallback={null}>
          <SceneContent />
        </Suspense>
      </Canvas>
    </SceneErrorBoundary>
  );
}
