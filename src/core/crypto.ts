import type { Block, LedgerEvent, MerkleProofItem, MerkleTree } from './types';

/** Stable JSON for this teaching model. Object keys sort recursively; array order matters. */
export function canonical(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('Canonical values must contain finite numbers.');
      return item;
    }
    if (Array.isArray(item)) {
      if (seen.has(item)) throw new Error('Cannot hash circular data.');
      seen.add(item);
      const result = item.map((child) => child === undefined ? null : normalize(child));
      seen.delete(item);
      return result;
    }
    if (typeof item === 'object' && item !== null) {
      if (seen.has(item)) throw new Error('Cannot hash circular data.');
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
        throw new Error('Canonical values must be JSON data, without class instances.');
      }
      seen.add(item);
      // A null prototype preserves even a JSON key named "__proto__" as data.
      const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(item).sort()) {
        const child = (item as Record<string, unknown>)[key];
        if (child !== undefined) result[key] = normalize(child);
      }
      seen.delete(item);
      return result;
    }
    throw new Error('Canonical values must be JSON-compatible data.');
  };
  return JSON.stringify(normalize(value));
}

/** Real SHA-256, through Web Crypto. No custom or simulated hash implementation. */
export async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable. Open MediChain through HTTPS or localhost.');
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hashRecord(content: Record<string, unknown>): Promise<string> {
  return sha256(canonical(content));
}

const isDigest = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);
const hashParent = (left: string, right: string): Promise<string> => sha256(canonical(['medichain:merkle-node:v1', left, right]));

/** Leaves are existing SHA-256 digests. Odd levels duplicate their final hash. */
export async function buildMerkleTree(leaves: string[]): Promise<MerkleTree> {
  if (leaves.some((leaf) => !isDigest(leaf))) throw new Error('Merkle leaves must be lowercase SHA-256 digests.');
  if (leaves.length === 0) {
    return { leaves: [], levels: [], root: await sha256('medichain:empty-merkle:v1') };
  }
  const levels = [[...leaves]];
  while (levels[levels.length - 1].length > 1) {
    const level = levels[levels.length - 1];
    const parents: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      parents.push(await hashParent(level[i], level[i + 1] ?? level[i]));
    }
    levels.push(parents);
  }
  return { leaves: [...leaves], levels, root: levels[levels.length - 1][0] };
}

export function getMerkleProof(tree: MerkleTree, index: number): MerkleProofItem[] {
  if (!Number.isInteger(index) || index < 0 || index >= tree.leaves.length) {
    throw new Error('Choose an existing Merkle leaf.');
  }
  const proof: MerkleProofItem[] = [];
  let position = index;
  for (let level = 0; level < tree.levels.length - 1; level += 1) {
    const hashes = tree.levels[level];
    const onRight = position % 2 === 1;
    const siblingIndex = onRight ? position - 1 : position + 1;
    proof.push({ sibling: hashes[siblingIndex] ?? hashes[position], side: onRight ? 'left' : 'right' });
    position = Math.floor(position / 2);
  }
  return proof;
}

export async function verifyMerkleProof(leaf: string, proof: MerkleProofItem[], root: string): Promise<boolean> {
  if (!isDigest(leaf) || !isDigest(root)) return false;
  let running = leaf;
  for (const item of proof) {
    if (!isDigest(item.sibling) || !['left', 'right'].includes(item.side)) return false;
    running = item.side === 'left' ? await hashParent(item.sibling, running) : await hashParent(running, item.sibling);
  }
  return running === root;
}

export function hashBlock(block: Omit<Block, 'hash'> | Block): Promise<string> {
  const { hash: _ignored, ...body } = block as Block;
  return sha256(canonical(body));
}

export async function createBlock(
  events: LedgerEvent[], previous: Block | undefined, clock: number,
  policyVersion: number, proposer: string, consensus: string,
): Promise<Block> {
  if (!Number.isFinite(clock)) throw new Error('The simulation clock must be finite.');
  const transactions = structuredClone(events);
  const leaves = await Promise.all(transactions.map((event) => sha256(canonical(event))));
  const { root } = await buildMerkleTree(leaves);
  const body: Omit<Block, 'hash'> = {
    index: previous ? previous.index + 1 : 0,
    timestamp: clock,
    previousHash: previous?.hash ?? '0'.repeat(64),
    merkleRoot: root,
    transactions,
    policyVersion,
    proposer,
    consensus,
  };
  return { ...body, hash: await hashBlock(body) };
}

/** Verifies content commitments and links; this is tamper evidence, not an external trust anchor. */
export async function verifyChain(blocks: Block[]): Promise<{ valid: boolean; index?: number; reason: string }> {
  if (blocks.length === 0) return { valid: false, reason: 'No genesis anchor is present.' };
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.index !== i) return { valid: false, index: i, reason: `Block ${i} has a non-contiguous index.` };
    const expectedPrevious = i === 0 ? '0'.repeat(64) : blocks[i - 1].hash;
    if (block.previousHash !== expectedPrevious) return { valid: false, index: i, reason: `Block ${i} no longer points to the preceding block hash.` };
    if (i > 0 && block.timestamp < blocks[i - 1].timestamp) return { valid: false, index: i, reason: `Block ${i} precedes the previous block's simulation time.` };
    const leaves = await Promise.all(block.transactions.map((event) => sha256(canonical(event))));
    if ((await buildMerkleTree(leaves)).root !== block.merkleRoot) return { valid: false, index: i, reason: `Block ${i}'s transactions do not match its Merkle root.` };
    if ((await hashBlock(block)) !== block.hash) return { valid: false, index: i, reason: `Block ${i}'s SHA-256 hash does not match its contents.` };
  }
  return { valid: true, reason: `All ${blocks.length} block hashes, Merkle roots, and previous-hash links match.` };
}

/**
 * Educational authentication fingerprint only. The public label is deliberately not a
 * secret, so this cannot prove private-key possession and is NOT a digital signature.
 */
export async function simulatedSignature(payload: unknown, publicKey: string): Promise<string> {
  return `SIM-${await sha256(canonical({ scheme: 'PUBLIC-LABEL-FINGERPRINT-NOT-A-SIGNATURE', publicKey, payload }))}`;
}
