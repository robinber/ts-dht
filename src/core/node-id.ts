/**
 * NodeId represents a unique identifier in the DHT network.
 * Following Kademlia specifications, we use a 160-bit (20-byte) identifier,
 * which provides a good balance between uniqueness and efficiency.
 */
import bs58 from "bs58";

export const HEX_PREFIX = "0x" as const;

export class NodeId {
  // The actual bytes of the ID stored as a Uint8Array
  private readonly bytes: Uint8Array;
  // Size of the NodeId in bytes (160 bits = 20 bytes) - Kademlia standard
  public static readonly SIZE_IN_BYTES = 20 as const;
  // Size of the NodeId in bits
  public static readonly SIZE_IN_BITS = NodeId.SIZE_IN_BYTES * 8;

  /**
   * Create a new NodeId from a Uint8Array.
   * @param bytes The bytes of the NodeId.
   */
  constructor(bytes: Uint8Array) {
    if (bytes.length !== NodeId.SIZE_IN_BYTES) {
      throw new Error(`NodeId must be ${NodeId.SIZE_IN_BYTES} bytes long`);
    }

    // Create a copy to prevent external modification
    this.bytes = new Uint8Array(bytes);
  }

  /**
   * Generate a new random NodeId.
   * In Kademlia, node IDs should be uniformly distributed
   * to ensure the routing table is balanced.
   */
  static random(): NodeId {
    const bytes = crypto.getRandomValues(new Uint8Array(NodeId.SIZE_IN_BYTES));
    return new NodeId(bytes);
  }

  /**
   * Create a NodeId from a public key or other secure input using a strong hash function.
   * This follows Kademlia S/Kademlia security enhancements where
   * node IDs are derived from public keys to prevent Sybil attacks.
   * @param input The input data to hash
   */
  static async fromSecureInput(input: Uint8Array): Promise<NodeId> {
    // Use SHA-256 for a strong cryptographic hash
    const hashBuffer = await crypto.subtle.digest("SHA-256", input);

    // Truncate the hash to match NodeId size (160 bits/20 bytes)
    const hashBytes = new Uint8Array(hashBuffer).slice(0, NodeId.SIZE_IN_BYTES);

    return new NodeId(hashBytes);
  }

  /**
   * Create a new NodeId from a hex string.
   */
  static fromHex(hex: string): NodeId {
    const trimHex = hex.startsWith(HEX_PREFIX) ? hex.slice(2) : hex;

    // Validate hex string contains only valid hex characters
    if (!/^[0-9a-fA-F]+$/.test(trimHex)) {
      throw new Error("Invalid hex string, must contain only 0-9, a-f, A-F");
    }

    if (trimHex.length !== NodeId.SIZE_IN_BYTES * 2) {
      throw new Error(
        `NodeId must be ${NodeId.SIZE_IN_BYTES * 2} characters long`,
      );
    }

    const bytes = new Uint8Array(NodeId.SIZE_IN_BYTES);

    for (let i = 0; i < NodeId.SIZE_IN_BYTES; i++) {
      const startIndex = i * 2;
      const endIndex = startIndex + 2;

      bytes[i] = Number.parseInt(trimHex.substring(startIndex, endIndex), 16);
    }

    return new NodeId(bytes);
  }

  /**
   * Create a NodeId from a base58 string (commonly used in P2P networks).
   * More compact than hex representation.
   * Uses the bs58 library for robust Base58 encoding/decoding.
   */
  static fromBase58(base58String: string): NodeId {
    // Decode the Base58 string to bytes
    const bytes = bs58.decode(base58String);

    // Check if the decoded bytes match the expected size
    if (bytes.length !== NodeId.SIZE_IN_BYTES) {
      throw new Error(
        `Invalid Base58 string: expected ${NodeId.SIZE_IN_BYTES} bytes but got ${bytes.length}`,
      );
    }

    return new NodeId(bytes);
  }

  /**
   * Get the bytes of the NodeId.
   * Returns a copy to prevent external modification.
   */
  getBytes(): Uint8Array {
    return new Uint8Array(this.bytes);
  }

  /**
   * Get the hex string representation of the NodeId.
   */
  toHex(): string {
    return Array.from(this.bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Get the base58 string representation.
   * More compact and user-friendly than hex.
   * Uses the bs58 library for robust Base58 encoding/decoding.
   */
  toBase58(): string {
    // Encode the bytes to a Base58 string
    return bs58.encode(this.bytes);
  }

  /**
   * Get a specific bit of the NodeId at a given position.
   * Critical for Kademlia's XOR metric and routing decisions.
   */
  getBit(index: number): boolean {
    if (index < 0 || index >= NodeId.SIZE_IN_BITS) {
      throw new Error(
        `Bit position must be between 0 and ${NodeId.SIZE_IN_BITS - 1}`,
      );
    }

    const byteIndex = Math.floor(index / 8);
    const bitIndex = index % 8;

    return (this.bytes[byteIndex] & (1 << (7 - bitIndex))) !== 0;
  }

  /**
   * Set a specific bit of the NodeId at a given position.
   * Returns a new NodeId with the bit set.
   */
  withBitSet(index: number, value: boolean): NodeId {
    if (index < 0 || index >= NodeId.SIZE_IN_BITS) {
      throw new Error(
        `Bit position must be between 0 and ${NodeId.SIZE_IN_BITS - 1}`,
      );
    }

    const newBytes = this.getBytes();
    const byteIndex = Math.floor(index / 8);
    const bitIndex = index % 8;
    const mask = 1 << (7 - bitIndex);

    if (value) {
      newBytes[byteIndex] |= mask;
    } else {
      newBytes[byteIndex] &= ~mask;
    }

    return new NodeId(newBytes);
  }

  /**
   * Calculate the common prefix length with another NodeId.
   * Essential for Kademlia's routing table organization.
   */
  commonPrefixLength(other: NodeId): number {
    let prefixLength = 0;

    // Optimize by checking bytes first before bits
    for (let i = 0; i < NodeId.SIZE_IN_BYTES; i++) {
      if (this.bytes[i] !== other.bytes[i]) {
        // Found a byte that differs, now check bit by bit
        const xor = this.bytes[i] ^ other.bytes[i];

        // Count leading zeros in the XOR result
        let mask = 0x80;
        while (mask > 0 && (xor & mask) === 0) {
          prefixLength++;
          mask >>= 1;
        }

        return prefixLength;
      }

      prefixLength += 8;
    }

    return prefixLength;
  }

  /**
   * Get the bucket index for another NodeId relative to this one.
   * In Kademlia, this determines which k-bucket the node belongs to.
   */
  getBucketIndex(other: NodeId): number {
    if (this.equals(other)) {
      return -1; // Same node
    }

    return NodeId.SIZE_IN_BITS - 1 - this.commonPrefixLength(other);
  }

  /**
   * Check if two NodeIds are equal.
   */
  equals(other: NodeId): boolean {
    // Use the built-in typed array comparison for efficiency
    return this.bytes.every((value, index) => value === other.bytes[index]);
  }

  /**
   * Create a string representation for debugging.
   */
  toString(): string {
    return `NodeId(${HEX_PREFIX}${this.toHex()})`;
  }
}
