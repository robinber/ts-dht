import type { NodeId } from "./node-id";

/**
 * Calculate the XOR distance between two NodeIds.
 * @param a First NodeId
 * @param b Second NodeId
 * @returns Uint8Array containing the XOR distance
 */
export function calculateDistance(a: NodeId, b: NodeId): Uint8Array {
  const aBytes = a.getBytes();
  const bBytes = b.getBytes();
  const aBytesLength = aBytes.length;

  const result = new Uint8Array(aBytesLength);

  for (let i = 0; i < aBytesLength; i++) {
    result[i] = aBytes[i] ^ bBytes[i];
  }

  return result;
}

/**
 * Compare two distances to determine which is closer to a target.
 * @param targetId Reference NodeId
 * @param aId First NodeId to compare
 * @param bId Second NodeId to compare
 * @returns Negative if aId is closer to targetId than bId,
 *          Positive if bId is closer to targetId than aId,
 *          Zero if both are equally distant from targetId
 */
export function compareDistances(
  targetId: NodeId,
  aId: NodeId,
  bId: NodeId,
): number {
  const distanceA = calculateDistance(targetId, aId);
  const distanceB = calculateDistance(targetId, bId);

  // Compare byte by byte, starting from most significant byte
  for (let i = 0; i < distanceA.length; i++) {
    if (distanceA[i] !== distanceB[i]) {
      return distanceA[i] - distanceB[i];
    }
  }

  // Both distances are equal
  return 0;
}
