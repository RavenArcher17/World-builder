/**
 * Google sign-in and per-user project storage in Cloud Firestore.
 *
 * Layout: users/{uid}/projects/{projectId}            metadata (name, size, current revision)
 *         users/{uid}/projects/{projectId}/chunks/{rev}_{n}   gzipped project bytes
 * New chunks are written before the metadata that points at them, and old ones are removed
 * afterwards, so a reader always sees one complete revision.
 *
 * This module is loaded lazily so the editor starts without waiting for the Firebase SDK.
 */
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  type User,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { Bytes, Timestamp, collection, doc, getDoc, getDocs, getFirestore, orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { parseProject, serializeProject } from '../core/project';
import type { Project } from '../core/types';
import { compress, decompress, joinChunks, splitChunks } from './codec';
import { firebaseConfig } from './config';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/** Stay well under Firestore's per-commit size limit. */
const MAX_BATCH_BYTES = 8_000_000;

export interface CloudUser {
  uid: string;
  name: string;
  email: string;
  /** Anonymous account: tied to this browser until linked to Google. */
  guest: boolean;
}

export interface CloudProject {
  id: string;
  name: string;
  mapCount: number;
  bytes: number;
  updatedAt: number;
}

function toUser(u: User | null): CloudUser | null {
  if (!u) return null;
  return { uid: u.uid, name: u.isAnonymous ? 'Guest' : u.displayName || u.email || 'You', email: u.email ?? '', guest: u.isAnonymous };
}

export function onUserChanged(cb: (user: CloudUser | null) => void): void {
  onAuthStateChanged(auth, (u) => cb(toUser(u)));
}

export function currentUser(): CloudUser | null {
  return toUser(auth.currentUser);
}

export async function signInAsGuest(): Promise<void> {
  await signInAnonymously(auth);
}

/**
 * Turn the guest account into a Google account, keeping its projects. If that Google account
 * already exists, sign into it and copy the guest's projects across instead.
 * Returns the number of projects copied (0 when the account was simply upgraded).
 */
export async function upgradeGuest(): Promise<number> {
  const guest = auth.currentUser;
  if (!guest?.isAnonymous) return 0;
  try {
    await linkWithPopup(guest, new GoogleAuthProvider());
    await guest.reload();
    return 0;
  } catch (e) {
    if (errorCode(e) !== 'auth/credential-already-in-use') throw e;
    const credential = GoogleAuthProvider.credentialFromError(e as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]);
    if (!credential) throw e;
    const projects = await Promise.all((await listProjects()).map((p) => loadProject(p.id)));
    await signInWithCredential(auth, credential);
    for (const p of projects) await saveProject(p);
    return projects.length;
  }
}

export async function signIn(): Promise<void> {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (errorCode(e) === 'auth/popup-blocked') await signInWithRedirect(auth, provider);
    else throw e;
  }
}

export function signOutUser(): Promise<void> {
  return signOut(auth);
}

function uid(): string {
  const u = auth.currentUser;
  if (!u) throw new Error('Sign in first');
  return u.uid;
}

const metaRef = (id: string) => doc(db, 'users', uid(), 'projects', id);
const chunkRef = (id: string, rev: string, n: number) => doc(db, 'users', uid(), 'projects', id, 'chunks', `${rev}_${n}`);

export async function listProjects(): Promise<CloudProject[]> {
  const snap = await getDocs(query(collection(db, 'users', uid(), 'projects'), orderBy('updatedAt', 'desc')));
  return snap.docs.map((d) => {
    const v = d.data({ serverTimestamps: 'estimate' });
    return {
      id: d.id,
      name: String(v.name ?? 'Untitled'),
      mapCount: Number(v.mapCount ?? 0),
      bytes: Number(v.bytes ?? 0),
      updatedAt: v.updatedAt instanceof Timestamp ? v.updatedAt.toMillis() : 0,
    };
  });
}

export async function saveProject(project: Project): Promise<void> {
  const data = await compress(serializeProject(project));
  const parts = splitChunks(data);
  const ref = metaRef(project.id);
  const previous = await getDoc(ref);
  const rev = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let batch = writeBatch(db);
  let size = 0;
  for (let n = 0; n < parts.length; n++) {
    if (size > 0 && size + parts[n].length > MAX_BATCH_BYTES) {
      await batch.commit();
      batch = writeBatch(db);
      size = 0;
    }
    batch.set(chunkRef(project.id, rev, n), { data: Bytes.fromUint8Array(parts[n]) });
    size += parts[n].length;
  }
  batch.set(ref, {
    name: project.name,
    mapCount: Object.keys(project.maps).length,
    bytes: data.length,
    rev,
    chunks: parts.length,
    encoding: 'gzip',
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  const old = previous.data();
  if (old?.rev && old.rev !== rev) await deleteChunks(project.id, String(old.rev), Number(old.chunks ?? 0));
}

export async function loadProject(id: string): Promise<Project> {
  const meta = await getDoc(metaRef(id));
  const v = meta.data();
  if (!v) throw new Error('That project is no longer in the cloud');
  const parts = await Promise.all(
    Array.from({ length: Number(v.chunks ?? 0) }, async (_, n) => {
      const snap = await getDoc(chunkRef(id, String(v.rev), n));
      const bytes = snap.get('data');
      if (!(bytes instanceof Bytes)) throw new Error('Cloud copy is incomplete — try again in a moment');
      return bytes.toUint8Array();
    }),
  );
  const project = parseProject(await decompress(joinChunks(parts)));
  project.id = id;
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  const meta = await getDoc(metaRef(id));
  const v = meta.data();
  if (v?.rev) await deleteChunks(id, String(v.rev), Number(v.chunks ?? 0));
  const batch = writeBatch(db);
  batch.delete(metaRef(id));
  await batch.commit();
}

async function deleteChunks(id: string, rev: string, count: number): Promise<void> {
  const batch = writeBatch(db);
  for (let n = 0; n < count; n++) batch.delete(chunkRef(id, rev, n));
  await batch.commit();
}

export function errorCode(e: unknown): string {
  return typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
}

/** A message that tells the user what to fix, for the errors setup problems cause. */
export function describeError(e: unknown): string {
  const code = errorCode(e);
  const msg = e instanceof Error ? e.message : String(e);
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in cancelled';
  if (code === 'auth/admin-restricted-operation') return 'Guest sign-in is not switched on (Firebase console → Authentication → Sign-in method → Anonymous).';
  if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found')
    return 'Google sign-in is not switched on yet (Firebase console → Authentication → Sign-in method → Google).';
  if (code === 'auth/unauthorized-domain')
    return `Sign-in is not allowed from ${location.hostname} (Firebase console → Authentication → Settings → Authorised domains).`;
  if (code === 'permission-denied') return 'The cloud database refused access — publish the security rules from firestore.rules.';
  if (code === 'not-found' || /database .* does not exist|firestore api has not been used|service_disabled/i.test(msg))
    return 'Create the Firestore database in the Firebase console first.';
  if (code === 'unavailable') return 'Cannot reach the cloud right now — check your connection.';
  return msg;
}
