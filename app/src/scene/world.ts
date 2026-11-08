import { InstancedMesh, Mesh, MeshBasicMaterial, Scene, type Material, type Object3D } from 'three/webgpu';
import { palette } from '../config/palette';
import { createMaterials } from './materials';
import { createMassing } from './massing';
import { createGates, GATE_STYLE_DEFAULTS, type GateStyle } from './gates';
import { createBridges } from './bridges';
import { createColumns } from './columns';
import { createCityWalls } from './walls';
import { createCity, type CityData } from './city';
import { createTrees, FOREST_SEED } from './trees';

export function createWorld(cityData: CityData) {
  const scene = new Scene();
  scene.name = 'tiananmen-map';
  const materials = createMaterials();
  scene.backgroundNode = materials.background;
  const style: GateStyle = { ...GATE_STYLE_DEFAULTS };
  let gates = createGates(materials, style);
  // Debug only: P0's OSM massing as a wireframe, to compare kit heights with the data.
  const wire = new MeshBasicMaterial({ color: palette.cinnabar, wireframe: true, transparent: true, opacity: 0.55 });
  const osm = createMassing({ platform: wire, timber: wire, roof: wire } as unknown as Parameters<typeof createMassing>[0]);
  osm.name = 'osm-overlay';
  osm.visible = false;
  const bridges = createBridges(materials);
  const columns = createColumns(materials);
  const city = createCity(cityData, materials);
  let wallSet = createCityWalls(cityData, materials);
  let walls = wallSet.root;
  city.labels.push(...wallSet.labels);
  let trees = createTrees(city.trees);
  scene.add(gates, osm, bridges, columns, city.root, walls, trees.root);

  function setWireframe(value: boolean) {
    scene.traverse(object => {
      if (object instanceof Mesh) {
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(material => {
          if ('wireframe' in material) (material as Material & { wireframe: boolean }).wireframe = value;
        });
      }
    });
  }
  function disposeTrees(root: typeof trees.root) {
    root.traverse(object => {
      if (!(object instanceof InstancedMesh)) return;
      object.dispose();
      (object.material as Material & { map?: { dispose(): void } | null }).map?.dispose();
      (object.material as Material).dispose();
    });
  }
  function disposeMeshes(root: Object3D) {
    root.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
  }
  /** Regenerate the kit geometry after a style change (debug panel). */
  function rebuildGates(patch: Partial<GateStyle>) {
    Object.assign(style, patch);
    const wallsVisible = walls.visible;
    scene.remove(gates, walls);
    disposeMeshes(gates); disposeMeshes(walls);
    gates = createGates(materials, style);
    wallSet = createCityWalls(cityData, materials);
    walls = wallSet.root;
    walls.visible = wallsVisible;
    scene.add(gates, walls);
  }
  function setSeed(seed = FOREST_SEED) {
    const visible = trees.root.visible;
    scene.remove(trees.root);
    disposeTrees(trees.root);
    trees = createTrees(city.trees, seed);
    trees.root.visible = visible;
    scene.add(trees.root);
  }
  return {
    scene, materials, bridges, columns, city, osm, style,
    get gates() { return gates; },
    get walls() { return walls; },
    get wallInfo() { return wallSet; },
    rebuildGates,
    get trees() { return trees; },
    setTreesVisible: (value: boolean) => { trees.root.visible = value; },
    setWireframe, setSeed,
    dispose() {
      city.cancelBuild();
      const geometries = new Set<Mesh['geometry']>();
      const all = new Set<Material>();
      scene.traverse(object => {
        if (!(object instanceof Mesh)) return;
        if (object instanceof InstancedMesh) object.dispose();
        geometries.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => all.add(m));
      });
      geometries.forEach(geometry => geometry.dispose());
      all.forEach(material => material.dispose());
      scene.clear();
    },
  };
}

export type World = ReturnType<typeof createWorld>;
