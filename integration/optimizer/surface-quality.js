/**
 * Phoenix Forge ONE — conservative, non-destructive surface-quality gate.
 *
 * This is a sampled, one-sided distance check (original -> simplified).
 * It prevents gross flattening/shrinkage but is NOT proof of identical looks,
 * UV quality, topology, or rig deformation. Never publish rejected geometry.
 */
import * as THREE from 'three';
import {MeshBVH} from 'three-mesh-bvh';

export function compareSurfaces(original, candidate, {
  samples = 1800,
  maxDistanceFraction = .012,
  rmsDistanceFraction = .0035,
  maxDimensionChange = .012
} = {}) {
  const before = original?.getAttribute?.('position');
  const after = candidate?.getAttribute?.('position');
  if (!before || !after || before.count < 3 || after.count < 3)
    return {accepted:false, reason:'Поверхность отсутствует или слишком мала.'};
  const beforeTriangles = (original.index?.count ?? before.count) / 3;
  const afterTriangles = (candidate.index?.count ?? after.count) / 3;
  if (!Number.isInteger(beforeTriangles) || !Number.isInteger(afterTriangles) || afterTriangles < 1)
    return {accepted:false, reason:'Некорректные треугольники после оптимизации.'};

  original.computeBoundingBox(); candidate.computeBoundingBox();
  const size = original.boundingBox.getSize(new THREE.Vector3());
  const diagonal = Math.max(size.length(), 1e-9);
  const candidateSize = candidate.boundingBox.getSize(new THREE.Vector3());
  const dimensionChanges = ['X','Y','Z'].map((axis,i) => {
    const source = size.getComponent(i), result = candidateSize.getComponent(i);
    return {axis, relative:Math.abs(result-source)/diagonal};
  });
  if (dimensionChanges.some(x => x.relative > maxDimensionChange))
    return {accepted:false, reason:'Габариты изменились сильнее допустимого.', dimensionChanges};

  // Index order of the original is unchanged. Sample deterministic triangle
  // centroids and one corner, so the gate stays bounded on a 1M-triangle GLB.
  const bvh = new MeshBVH(candidate, {indirect:true});
  const p = new THREE.Vector3(), hit = {};
  const n = Math.max(1,Math.min(Math.floor(samples), beforeTriangles));
  let maxDistance = 0, sumSquared = 0, visited = 0;
  const idx = original.index;
  for (let s=0;s<n;s++) {
    const t = Math.floor((s+.5)*beforeTriangles/n);
    const ids = [0,1,2].map(k=>idx?idx.getX(t*3+k):t*3+k);
    if (ids.some(k=>k<0||k>=before.count))
      return {accepted:false,reason:'Повреждён индекс исходной геометрии.'};
    const corners = ids.map(k=>[before.getX(k),before.getY(k),before.getZ(k)]);
    for (const pt of [corners[0], [
      (corners[0][0]+corners[1][0]+corners[2][0])/3,
      (corners[0][1]+corners[1][1]+corners[2][1])/3,
      (corners[0][2]+corners[1][2]+corners[2][2])/3
    ]]) {
      p.set(...pt);
      if (![p.x,p.y,p.z].every(Number.isFinite))
        return {accepted:false,reason:'Некорректные координаты исходной геометрии.'};
      const result = bvh.closestPointToPoint(p,hit);
      if (!result || !Number.isFinite(hit.distance))
        return {accepted:false,reason:'Не удалось измерить геометрическую ошибку.'};
      maxDistance = Math.max(maxDistance,hit.distance);
      sumSquared += hit.distance*hit.distance;
      visited++;
    }
  }
  const maxFraction=maxDistance/diagonal, rmsFraction=Math.sqrt(sumSquared/visited)/diagonal;
  const accepted = maxFraction<=maxDistanceFraction && rmsFraction<=rmsDistanceFraction;
  return {accepted,maxFraction,rmsFraction,samples:visited,dimensionChanges,
    reason:accepted?'': 'Упрощение заметно изменило поверхность (форма/объём). Исходная геометрия сохранена.'};
}
