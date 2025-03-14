import { describe, expect, it } from "vitest";
import { HEX_PREFIX, NodeId } from "../src/node-id";

describe("NodeId", () => {
	// Valid test values
	const validBytes = new Uint8Array(Array(20).fill(1));
	const validHex = "0101010101010101010101010101010101010101";
	const validHexWithPrefix = `${HEX_PREFIX}${validHex}`;

	describe("constructor", () => {
		it("should create a NodeId from valid bytes", () => {
			// GIVEN
			const nodeId = new NodeId(validBytes);

			// THEN
			expect(nodeId).toBeInstanceOf(NodeId);
		});

		it("should throw an error if bytes length is too short", () => {
			// GIVEN
			const invalidBytes = new Uint8Array(10);

			// WHEN & THEN
			expect(() => new NodeId(invalidBytes)).toThrow(
				"NodeId must be 20 bytes long",
			);
		});

		it("should throw an error if bytes length is too long", () => {
			// GIVEN
			const invalidBytes = new Uint8Array(30);

			// WHEN & THEN
			expect(() => new NodeId(invalidBytes)).toThrow(
				"NodeId must be 20 bytes long",
			);
		});
	});

	describe("random", () => {
		it("should create a random NodeId", () => {
			// GIVEN
			const nodeId = NodeId.random();

			// WHEN & THEN
			expect(nodeId).toBeInstanceOf(NodeId);
			expect(nodeId.getBytes().length).toBe(20);
		});

		it("should create different NodeIds on subsequent calls", () => {
			// GIVEN
			const nodeId1 = NodeId.random();
			const nodeId2 = NodeId.random();

			// WHEN & THEN
			expect(nodeId1.equals(nodeId2)).toBe(false);
		});
	});

	describe("fromHex", () => {
		it("should create a NodeId from a valid hex string", () => {
			// GIVEN
			const nodeId = NodeId.fromHex(validHex);

			// WHEN & THEN
			expect(nodeId).toBeInstanceOf(NodeId);
			expect(nodeId.toHex()).toBe(validHex);
		});

		it("should create a NodeId from a hex string with prefix", () => {
			// GIVEN
			const nodeId = NodeId.fromHex(validHexWithPrefix);

			// WHEN & THEN
			expect(nodeId).toBeInstanceOf(NodeId);
			expect(nodeId.toHex()).toBe(validHex);
		});

		it("should throw an error if hex string length is too short", () => {
			// GIVEN
			const shortHex = "010101";

			// WHEN & THEN
			expect(() => NodeId.fromHex(shortHex)).toThrow(
				"NodeId must be 40 characters long",
			);
		});
		it("should throw an error if hex string length is too long", () => {
			// GIVEN
			const longHex = validHex + validHex;

			// WHEN & THEN
			expect(() => NodeId.fromHex(longHex)).toThrow(
				"NodeId must be 40 characters long",
			);
		});
	});

	describe("getBytes", () => {
		it("should return a copy of the internal bytes", () => {
			// GIVEN
			const nodeId = new NodeId(validBytes);
			const returnedBytes = nodeId.getBytes();

			// WHEN & THEN
			// Check it's a copy, not the same reference
			expect(returnedBytes).not.toBe(validBytes);

			// Check the values are the same
			expect(Array.from(returnedBytes)).toEqual(Array.from(validBytes));
		});

		it("should return a copy that cannot affect the original", () => {
			// GIVEN
			const nodeId = new NodeId(validBytes);
			const returnedBytes = nodeId.getBytes();

			// WHEN & THEN
			// Modify the returned bytes
			returnedBytes[0] = 99;

			// Check the original is unaffected
			const newReturnedBytes = nodeId.getBytes();
			expect(newReturnedBytes[0]).toBe(1);
		});
	});

	describe("toHex", () => {
		it("should return the correct hex representation", () => {
			// GIVEN
			const bytes = new Uint8Array(20);
			bytes[0] = 255; // ff in hex
			bytes[1] = 15; // 0f in hex
			bytes[2] = 1; // 01 in hex

			// WHEN
			const nodeId = new NodeId(bytes);

			// THEN
			const expectedHex = `ff0f01${"00".repeat(17)}`;

			expect(nodeId.toHex()).toBe(expectedHex);
		});

		it("should pad single-digit hex values with zeros", () => {
			// GIVEN
			const bytes = new Uint8Array([
				15, 7, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
			]);

			// WHEN
			const nodeId = new NodeId(bytes);

			// THEN
			const expectedHex = "0f07030100000000000000000000000000000000";
			expect(nodeId.toHex()).toBe(expectedHex);
		});
	});

	describe("getBit", () => {
		it("should return the correct bit value", () => {
			// GIVEN
			// Create a NodeId with a known bit pattern
			const bytes = new Uint8Array(20).fill(0);
			bytes[0] = 0b10101010; // 10101010 in binary

			// WHEN
			const nodeId = new NodeId(bytes);

			// THEN
			expect(nodeId.getBit(0)).toBe(true);
			expect(nodeId.getBit(1)).toBe(false);
			expect(nodeId.getBit(2)).toBe(true);
			expect(nodeId.getBit(3)).toBe(false);
		});

		it("should throw an error for out of range indices", () => {
			// GIVEN
			const nodeId = NodeId.random();

			// WHEN & THEN
			expect(() => nodeId.getBit(-1)).toThrow("Bit position must be between");
			expect(() => nodeId.getBit(NodeId.SIZE_IN_BITS)).toThrow(
				"Bit position must be between",
			);
		});
	});

	describe("commonPrefixLength", () => {
		it("should return the correct common prefix length for identical IDs", () => {
			// GIVEN
			const nodeId = NodeId.random();

			// WHEN & THEN
			expect(nodeId.commonPrefixLength(nodeId)).toBe(NodeId.SIZE_IN_BITS);
		});

		it("should return 0 for IDs with no common prefix", () => {
			// GIVEN
			const bytes1 = new Uint8Array(20).fill(0);
			bytes1[0] = 0b10000000; // First bit is 1

			const bytes2 = new Uint8Array(20).fill(0);
			bytes2[0] = 0b00000000; // First bit is 0

			// WHEN
			const nodeId1 = new NodeId(bytes1);
			const nodeId2 = new NodeId(bytes2);

			// THEN
			expect(nodeId1.commonPrefixLength(nodeId2)).toBe(0);
		});

		it("should return the correct common prefix length for partially matching IDs", () => {
			// GIVEN
			const bytes1 = new Uint8Array(20).fill(0);
			bytes1[0] = 0b11110000; // First 4 bits are 1

			const bytes2 = new Uint8Array(20).fill(0);
			bytes2[0] = 0b11100000; // First 3 bits are 1

			// WHEN
			const nodeId1 = new NodeId(bytes1);
			const nodeId2 = new NodeId(bytes2);

			// THEN
			expect(nodeId1.commonPrefixLength(nodeId2)).toBe(3);
		});
	});

	describe("equals", () => {
		it("should return true for equal NodeIds", () => {
			// GIVEN
			const nodeId1 = new NodeId(validBytes);
			const nodeId2 = new NodeId(new Uint8Array(validBytes));

			// WHEN & THEN
			expect(nodeId1.equals(nodeId2)).toBe(true);
		});

		it("should return false for different NodeIds", () => {
			// GIVEN
			const bytes1 = new Uint8Array(20).fill(1);
			const bytes2 = new Uint8Array(20).fill(2);

			// WHEN
			const nodeId1 = new NodeId(bytes1);
			const nodeId2 = new NodeId(bytes2);

			// THEN
			expect(nodeId1.equals(nodeId2)).toBe(false);
		});

		it("should return false if even one byte is different", () => {
			// GIVEN
			const bytes1 = new Uint8Array(20).fill(1);
			const bytes2 = new Uint8Array(20).fill(1);
			bytes2[19] = 2; // Only the last byte is different

			// WHEN
			const nodeId1 = new NodeId(bytes1);
			const nodeId2 = new NodeId(bytes2);

			// THEN
			expect(nodeId1.equals(nodeId2)).toBe(false);
		});
	});
});
