import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, compress, decompress, joinChunks, splitChunks } from '../src/cloud/codec';
import { createProject, parseProject, serializeProject } from '../src/core/project';
import { make } from './helpers';

describe('cloud storage encoding', () => {
  it('round-trips a project through gzip and chunking', async () => {
    const p = createProject('cloud');
    for (const m of [make('kingdom', 'hex-pointy', 1), make('town', 'square', 2), make('dungeon', 'iso', 3)]) p.maps[m.id] = m;
    const json = serializeProject(p);
    const packed = await compress(json);
    expect(packed.length).toBeLessThan(json.length / 4);
    const parts = splitChunks(packed, 10_000);
    expect(parts.every((x) => x.length <= 10_000)).toBe(true);
    const back = parseProject(await decompress(joinChunks(parts)));
    expect(back).toEqual(p);
  });

  it('keeps every chunk inside one Firestore document', () => {
    expect(CHUNK_BYTES).toBeLessThan(1_048_576 - 10_000);
    expect(splitChunks(new Uint8Array(0))).toHaveLength(1);
    expect(splitChunks(new Uint8Array(CHUNK_BYTES * 2 + 1)).map((x) => x.length)).toEqual([CHUNK_BYTES, CHUNK_BYTES, 1]);
  });

  it('gives every project a stable, safe id', () => {
    const p = createProject('x');
    expect(p.id).toMatch(/^[\w-]+$/);
    expect(parseProject(serializeProject(p)).id).toBe(p.id);
    const legacy = JSON.parse(serializeProject(p));
    delete legacy.id;
    expect(parseProject(JSON.stringify(legacy)).id).toMatch(/^proj_/);
    legacy.id = '../../evil';
    expect(parseProject(JSON.stringify(legacy)).id).toMatch(/^proj_/);
  });
});
