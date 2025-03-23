import type { NodeId } from "./node-id";

/**
 * Calculate the XOR distance between two NodeIds.
 * XOR distance is the core metric in Kademlia, providing a symmetric,
 * unidirectional measure of closeness in the network.
 *
 * @param a First NodeId
 * @param b Second NodeId
 * @returns Uint8Array containing the XOR distance
 */
export function calculateDistance(a: NodeId, b: NodeId): Uint8Array {
  const aBytes = a.getBytes();
  const bBytes = b.getBytes();
  const result = new Uint8Array(aBytes.length);

  for (let i = 0; i < aBytes.length; i++) {
    result[i] = aBytes[i] ^ bBytes[i];
  }

  return result;
}

/**
 * Compare two distances to determine which is closer to a target.
 * Essential for finding the k closest nodes to a target in Kademlia.
 *
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

  // Compare byte by byte, starting from most significant byte (big-endian)
  for (let i = 0; i < distanceA.length; i++) {
    if (distanceA[i] !== distanceB[i]) {
      return distanceA[i] - distanceB[i];
    }
  }

  return 0;
}

/**
 * Calculate the scalar distance between two NodeIds.
 * This provides a numerical representation of the XOR distance,
 * useful for sorting nodes by distance.
 *
 * @param a First NodeId
 * @param b Second NodeId
 * @returns A BigInt representing the scalar distance (XOR interpreted as an integer)
 */
export function calculateScalarDistance(a: NodeId, b: NodeId): bigint {
  const distance = calculateDistance(a, b);
  const byteLength = distance.length;

  // Find the first non-zero byte to optimize calculation
  for (let i = 0; i < byteLength; i++) {
    if (distance[i] !== 0) {
      // Optimize with a fast path for common sizes
      if (i === 0) {
        // Process all bytes at once when possible
        if (byteLength <= 6) {
          // For up to 6 bytes (48 bits), we can use Number
          // which is significantly faster than BigInt operations
          let result = 0;
          for (let j = 0; j < byteLength; j++) {
            result = (result << 8) | distance[j];
          }
          return BigInt(result);
        }
      }

      // Process remaining bytes with BigInt for larger values
      let result = 0n;
      for (let j = i; j < byteLength; j++) {
        result = (result << 8n) | BigInt(distance[j]);
      }
      return result;
    }
  }

  // All bytes are zero, return zero (nodes are identical)
  return 0n;
}

/**
 * Check if a NodeId falls within a specific distance range.
 * Useful for range queries and implementing distance-based filters.
 *
 * @param id The NodeId to check
 * @param target The target NodeId
 * @param maxDistance The maximum allowed distance (as a BigInt)
 * @returns true if id is within maxDistance of target, false otherwise
 */
export function isWithinDistance(
  id: NodeId,
  target: NodeId,
  maxDistance: bigint,
): boolean {
  const distance = calculateScalarDistance(id, target);
  return distance <= maxDistance;
}

/**
 * Find the log2 distance between two NodeIds.
 * This gives the bucket index in a traditional Kademlia routing table.
 *
 * @param a First NodeId
 * @param b Second NodeId
 * @returns The log2 distance, or -1 if the NodeIds are identical
 */
export function log2Distance(a: NodeId, b: NodeId): number {
  const distance = calculateDistance(a, b);

  // Find the index of the first non-zero byte
  for (let i = 0; i < distance.length; i++) {
    if (distance[i] !== 0) {
      // Find the position of the most significant bit in this byte
      let byte = distance[i];
      let bitPosition = 0;

      while ((byte & 0x80) === 0 && bitPosition < 8) {
        byte <<= 1;
        bitPosition++;
      }

      return i * 8 + bitPosition;
    }
  }

  return -1; // NodeIds are identical
}
