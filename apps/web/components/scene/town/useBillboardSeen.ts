'use client';

import { useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Frustum, Matrix4, Vector3, type Object3D } from 'three';
import { isBillboardSlot } from '@wtc/shared';
import { trackBillboard } from '@/lib/analytics';

/**
 * Counts an ad slot as seen once its centre has been inside the camera's view for two seconds
 * in total (checked four times a second). Reported once per page load, anonymously.
 */
export function useBillboardSeen(slot: string, ref: RefObject<Object3D | null>) {
  const camera = useThree((s) => s.camera);
  const visibleFor = useRef(0);
  const sinceCheck = useRef(0);
  const done = useRef(!isBillboardSlot(slot));
  const tmp = useMemo(() => ({ frustum: new Frustum(), m: new Matrix4(), p: new Vector3() }), []);
  useFrame((_, dt) => {
    if (done.current || !ref.current) return;
    sinceCheck.current += dt;
    if (sinceCheck.current < 0.25) return;
    const step = sinceCheck.current;
    sinceCheck.current = 0;
    tmp.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    tmp.frustum.setFromProjectionMatrix(tmp.m);
    ref.current.getWorldPosition(tmp.p);
    if (!tmp.frustum.containsPoint(tmp.p)) return;
    visibleFor.current += step;
    if (visibleFor.current >= 2 && isBillboardSlot(slot)) {
      done.current = true;
      trackBillboard(slot);
    }
  });
}
