/**
 * Game-ready exports. All functions are pure (no DOM) so they can also run in Node scripts;
 * image outputs (PNG map, Tiled tileset) are produced by the UI renderer.
 */
import { featureDef } from '../features';
import { DIRECTION_NAMES, Grid, GridType } from '../grid';
import { extractPolylines } from '../links';
import { getScale } from '../scales';
import { OBJECTS, objectDef } from '../objects';
import { TILES } from '../tiles';
import type { WorldMap } from '../types';

const S3 = Math.sqrt(3);

// ---- native game JSON ---------------------------------------------------------------------

export function toGameJson(map: WorldMap): object {
  const g = new Grid(map.grid, map.width, map.height);
  const used = new Set(map.layers.terrain);
  return {
    format: 'world-builder-map',
    version: 1,
    name: map.name,
    kind: map.kind,
    scale: { id: map.scaleId, label: getScale(map.scaleId).label, cell: getScale(map.scaleId).cell },
    seed: map.seed,
    grid: {
      type: map.grid,
      width: map.width,
      height: map.height,
      layout: 'row-major: index = row * width + col',
      offset: gridOffsetDescription(map.grid),
      directions: DIRECTION_NAMES[map.grid],
      directionBits: 'road/river value bit d (1 << d) = connected to the neighbour in directions[d]',
    },
    legend: TILES.filter((t) => used.has(t.id)).map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      color: t.color,
      category: t.category,
      walkable: t.walkable,
    })),
    layers: {
      terrain: map.layers.terrain,
      elevation: map.layers.elevation,
      moisture: map.layers.moisture,
      temperature: map.layers.temperature,
      road: map.layers.road,
      roadLevel: map.layers.roadLevel,
      river: map.layers.river,
      riverSize: map.layers.riverSize,
      building: map.layers.building,
      object: map.layers.object,
      ...(map.layers.zone.some(Boolean) && { zone: map.layers.zone }),
    },
    objectLegend: OBJECTS.map((d) => (d.id ? { id: d.id, key: d.key, name: d.name, blocksWalking: d.blocks, usedFromNeighbour: d.useFromNeighbour } : { id: 0, key: '', name: 'Nothing' })),
    roads: extractPolylines(g, map.layers.road).map((cells) => cells.map((i) => [g.col(i), g.row(i)])),
    rivers: extractPolylines(g, map.layers.river).map((cells) => cells.map((i) => [g.col(i), g.row(i)])),
    features: map.features.map((f) => ({
      id: f.id,
      type: f.type,
      category: featureDef(f.type).label,
      name: f.name,
      col: f.c,
      row: f.r,
      tags: f.tags ?? [],
      notes: f.notes ?? '',
      props: f.props ?? {},
      detailMapId: f.childMapId ?? null,
    })),
    parent: map.parent ?? null,
    children: map.children,
  };
}

function gridOffsetDescription(grid: GridType): string {
  switch (grid) {
    case 'hex-pointy':
      return 'pointy-top hexes, odd rows shifted right by half a hex (odd-r; Tiled staggeraxis=y, staggerindex=odd)';
    case 'hex-flat':
      return 'flat-top hexes, odd columns shifted down by half a hex (odd-q; Tiled staggeraxis=x, staggerindex=odd)';
    case 'iso':
      return 'square grid in a diamond isometric projection (Tiled orientation=isometric)';
    default:
      return 'square tiles';
  }
}

// ---- Tiled (.tmj) ---------------------------------------------------------------------------

export interface TilePixels {
  tileWidth: number;
  tileHeight: number;
  hexSide?: number;
}

/** Pixel sizes used for Tiled export and the matching tileset image. */
export function tilePixels(grid: GridType): TilePixels {
  switch (grid) {
    case 'hex-pointy':
      return { tileWidth: 28, tileHeight: 32, hexSide: 16 };
    case 'hex-flat':
      return { tileWidth: 32, tileHeight: 28, hexSide: 16 };
    case 'iso':
      return { tileWidth: 64, tileHeight: 32 };
    default:
      return { tileWidth: 32, tileHeight: 32 };
  }
}

export const TILESET_COLUMNS = 8;

/** Object-layer pixel coordinates of a cell centre, following Tiled's conventions per orientation. */
function tiledPoint(g: Grid, i: number, px: TilePixels): { x: number; y: number } {
  if (g.type === 'iso') {
    const [x, y] = g.pos(i);
    return { x: x * px.tileHeight, y: y * px.tileHeight };
  }
  const [rx, ry] = g.center(i);
  switch (g.type) {
    case 'hex-pointy':
      return { x: (rx * px.tileWidth) / S3, y: ry * (px.hexSide ?? 16) };
    case 'hex-flat':
      return { x: rx * (px.hexSide ?? 16), y: (ry * px.tileHeight) / S3 };
    default:
      return { x: rx * px.tileWidth, y: ry * px.tileHeight };
  }
}

export function toTiled(map: WorldMap, tilesetImage: string): object {
  const g = new Grid(map.grid, map.width, map.height);
  const px = tilePixels(map.grid);
  let objectId = 1;
  const polyLayer = (id: number, name: string, layer: number[], level?: number[]) => ({
    id,
    name,
    type: 'objectgroup',
    draworder: 'topdown',
    opacity: 1,
    visible: true,
    x: 0,
    y: 0,
    objects: extractPolylines(g, layer).map((cells) => {
      const pts = cells.map((i) => tiledPoint(g, i, px));
      const o = pts[0];
      const lvl = level ? Math.max(...cells.map((i) => level[i])) : undefined;
      return {
        id: objectId++,
        name: '',
        type: name === 'roads' ? 'road' : 'river',
        x: o.x,
        y: o.y,
        width: 0,
        height: 0,
        rotation: 0,
        visible: true,
        polyline: pts.map((p) => ({ x: p.x - o.x, y: p.y - o.y })),
        properties: lvl !== undefined ? [{ name: 'level', type: 'int', value: lvl }] : [],
      };
    }),
  });
  const layers = [
    {
      id: 1,
      name: 'terrain',
      type: 'tilelayer',
      width: map.width,
      height: map.height,
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      data: map.layers.terrain.map((t) => t + 1),
    },
    polyLayer(2, 'rivers', map.layers.river),
    polyLayer(3, 'roads', map.layers.road, map.layers.roadLevel),
    {
      id: 4,
      name: 'features',
      type: 'objectgroup',
      draworder: 'topdown',
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
      objects: map.features.map((f) => {
        const p = tiledPoint(g, g.idx(f.c, f.r), px);
        return {
          id: objectId++,
          name: f.name,
          type: f.type,
          x: p.x,
          y: p.y,
          width: 0,
          height: 0,
          rotation: 0,
          visible: true,
          point: true,
          properties: [
            { name: 'col', type: 'int', value: f.c },
            { name: 'row', type: 'int', value: f.r },
            { name: 'notes', type: 'string', value: f.notes ?? '' },
            { name: 'tags', type: 'string', value: (f.tags ?? []).join(',') },
            ...Object.entries(f.props ?? {}).map(([name, value]) => ({
              name,
              type: typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : typeof value === 'boolean' ? 'bool' : 'string',
              value,
            })),
          ],
        };
      }),
    },
    {
      id: 5,
      name: 'objects',
      type: 'objectgroup',
      draworder: 'topdown',
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
      objects: map.layers.object.flatMap((o, i) => {
        const d = objectDef(o);
        if (!d) return [];
        const p = tiledPoint(g, i, px);
        return [{ id: objectId++, name: d.name, type: d.key, x: p.x, y: p.y, width: 0, height: 0, rotation: 0, visible: true, point: true,
          properties: [{ name: 'blocksWalking', type: 'bool', value: d.blocks }] }];
      }),
    },
  ];
  const rows = Math.ceil(TILES.length / TILESET_COLUMNS);
  const out: Record<string, unknown> = {
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.2',
    orientation: map.grid === 'square' ? 'orthogonal' : map.grid === 'iso' ? 'isometric' : 'hexagonal',
    renderorder: 'right-down',
    width: map.width,
    height: map.height,
    tilewidth: px.tileWidth,
    tileheight: px.tileHeight,
    infinite: false,
    nextlayerid: 6,
    nextobjectid: objectId,
    layers,
    tilesets: [
      {
        firstgid: 1,
        name: 'world-builder',
        image: tilesetImage,
        imagewidth: px.tileWidth * TILESET_COLUMNS,
        imageheight: px.tileHeight * rows,
        tilewidth: px.tileWidth,
        tileheight: px.tileHeight,
        tilecount: TILES.length,
        columns: TILESET_COLUMNS,
        margin: 0,
        spacing: 0,
        tiles: TILES.map((t) => ({
          id: t.id,
          type: t.key,
          properties: [
            { name: 'name', type: 'string', value: t.name },
            { name: 'category', type: 'string', value: t.category },
            { name: 'walkable', type: 'bool', value: t.walkable },
          ],
        })),
      },
    ],
    properties: [
      { name: 'generator', type: 'string', value: 'world-builder' },
      { name: 'scale', type: 'string', value: map.scaleId },
      { name: 'seed', type: 'int', value: map.seed },
    ],
  };
  if (map.grid === 'hex-pointy' || map.grid === 'hex-flat') {
    out.hexsidelength = px.hexSide;
    out.staggeraxis = map.grid === 'hex-pointy' ? 'y' : 'x';
    out.staggerindex = 'odd';
  }
  return out;
}

// ---- CSV ----------------------------------------------------------------------------------

export function toCsv(map: WorldMap, layer: keyof WorldMap['layers'] = 'terrain'): string {
  const rows: string[] = [];
  const data = map.layers[layer];
  for (let r = 0; r < map.height; r++) rows.push(data.slice(r * map.width, (r + 1) * map.width).join(','));
  return rows.join('\n') + '\n';
}

export function legendCsv(): string {
  return ['id,key,name,color,category,walkable', ...TILES.map((t) => `${t.id},${t.key},"${t.name}",${t.color},${t.category},${t.walkable}`)].join('\n') + '\n';
}
