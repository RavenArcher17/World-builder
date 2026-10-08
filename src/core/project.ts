import { emptyLayers, MapLayers, Project, WorldMap } from './types';

export function createProject(name = 'My World'): Project {
  return { format: 'world-builder-project', version: 1, name, maps: {} };
}

export function addMap(project: Project, map: WorldMap): void {
  project.maps[map.id] = map;
}

/** Remove a map and all of its descendants, unlinking it from its parent. */
export function deleteMap(project: Project, id: string): string[] {
  const removed: string[] = [];
  const visit = (mid: string) => {
    const m = project.maps[mid];
    if (!m) return;
    for (const c of m.children) visit(c);
    delete project.maps[mid];
    removed.push(mid);
  };
  const map = project.maps[id];
  if (!map) return removed;
  if (map.parent) {
    const parent = project.maps[map.parent.mapId];
    if (parent) {
      parent.children = parent.children.filter((c) => c !== id);
      for (const f of parent.features) if (f.childMapId === id) delete f.childMapId;
    }
  }
  visit(id);
  return removed;
}

/** Maps without a (living) parent, i.e. the roots of the atlas tree. */
export function rootMaps(project: Project): WorldMap[] {
  return Object.values(project.maps).filter((m) => !m.parent || !project.maps[m.parent.mapId]);
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project);
}

export function parseProject(text: string): Project {
  const data = JSON.parse(text);
  if (!data || data.format !== 'world-builder-project' || typeof data.maps !== 'object') {
    throw new Error('Not a World Builder project file');
  }
  const project = data as Project;
  for (const m of Object.values(project.maps)) {
    const size = m.width * m.height;
    const blank = emptyLayers(size);
    m.layers = m.layers ?? blank;
    for (const k of Object.keys(blank) as (keyof MapLayers)[]) {
      if (!Array.isArray(m.layers[k]) || m.layers[k].length !== size) m.layers[k] = blank[k];
    }
    m.features = m.features ?? [];
    m.children = (m.children ?? []).filter((c) => c in project.maps);
    m.settings = m.settings ?? {};
  }
  return project;
}
