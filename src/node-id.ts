/**
 * NodeId represents a unique identifier in the DHT network.
 * We'll use a 160-bit (20-byte) identifier, which provides a good
 * balance between uniqueness and efficiency.
 */
export const HEX_PREFIX = "0x" as const;

export class NodeId {
	// The actual bytes of the ID stored as a Uint8Array
	private readonly bytes: Uint8Array;
	// Size of the NodeId in bytes (160 bits = 20 bytes)
	private static readonly SIZE_IN_BYTES = 20 as const;
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

		this.bytes = bytes;
	}

	/**
	 * Generate a new random NodeId.
	 */
	static random(): NodeId {
		const bytes = crypto.getRandomValues(new Uint8Array(NodeId.SIZE_IN_BYTES));

		return new NodeId(bytes);
	}

	/**
	 * Create a new NodeId from a hex string.
	 */
	static fromHex(hex: string): NodeId {
		const trimHex = hex.startsWith(HEX_PREFIX) ? hex.slice(2) : hex;

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
	 * Get the bytes of the NodeId.
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
	 * Get a specific byte of the NodeId at a given position.
	 */
	getBit(index: number): boolean {
		if (index < 0 || index >= NodeId.SIZE_IN_BITS) {
			throw new Error(
				`Bit position must be between 0 and ${NodeId.SIZE_IN_BYTES * 8 - 1}`,
			);
		}

		const byteIndex = Math.floor(index / 8);
		const bitIndex = index % 8;

		return (this.bytes[byteIndex] & (1 << (7 - bitIndex))) !== 0;
	}

	/**
	 * Calculate the common prefix length with another NodeId
	 * This is useful for routing table organization
	 */
	commonPrefixLength(other: NodeId): number {
		let prefixLength = 0;

		for (let i = 0; i < NodeId.SIZE_IN_BYTES * 8; i++) {
			if (this.getBit(i) !== other.getBit(i)) {
				break;
			}
			prefixLength++;
		}

		return prefixLength;
	}

	/**
	 * Check if 2 Nodes are equal
	 */
	equals(other: NodeId): boolean {
		const a = this.bytes;
		const b = other.getBytes();

		for (let i = 0; i < NodeId.SIZE_IN_BYTES; i++) {
			if (a[i] !== b[i]) {
				return false;
			}
		}

		return true;
	}
}
