import { describe, expect, it } from "vitest";
import {
  calculateDistance,
  calculateScalarDistance,
  compareDistances,
  isWithinDistance,
  log2Distance,
} from "./distance";
import { NodeId } from "./node-id";

describe("Distance Functions", () => {
  describe("calculateDistance", () => {
    it("should return a zero distance for identical NodeIds", () => {
      // GIVEN
      const nodeId = NodeId.random();

      // WHEN
      const distance = calculateDistance(nodeId, nodeId);

      // THEN
      // Distance should be all zeros
      expect(distance.every((byte) => byte === 0)).toBe(true);
    });

    it("should return a non-zero distance for different NodeIds", () => {
      // GIVEN
      const bytes1 = new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      ]);
      const bytes2 = new Uint8Array([
        20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
      ]);

      // WHEN
      const nodeId1 = new NodeId(bytes1);
      const nodeId2 = new NodeId(bytes2);
      const distance = calculateDistance(nodeId1, nodeId2);

      // THEN
      // At least one byte should be non-zero
      expect(distance.some((byte) => byte !== 0)).toBe(true);

      // The distance should equal to XOR of the bytes
      for (let i = 0; i < bytes1.length; i++) {
        expect(distance[i]).toBe(bytes1[i] ^ bytes2[i]);
      }
    });

    it("should be symmetric (distance from A to B = distance from B to A)", () => {
      // GIVEN
      const nodeId1 = NodeId.random();
      const nodeId2 = NodeId.random();

      // WHEN
      const distance1to2 = calculateDistance(nodeId1, nodeId2);
      const distance2to1 = calculateDistance(nodeId2, nodeId1);

      // THEN
      expect(Array.from(distance1to2)).toEqual(Array.from(distance2to1));
    });
  });

  describe("calculateScalarDistance", () => {
    it("should return zero for identical NodeIds", () => {
      // GIVEN
      const nodeId = NodeId.random();

      // WHEN
      const distance = calculateScalarDistance(nodeId, nodeId);

      // THEN
      expect(distance).toBe(0n);
    });

    it("should calculate correct scalar distance", () => {
      // GIVEN
      // Create two NodeIds with a known XOR value
      const bytes1 = new Uint8Array(20).fill(0);
      const bytes2 = new Uint8Array(20).fill(0);

      // Only the first byte is different, with XOR value 255
      bytes1[0] = 255;
      bytes2[0] = 0;

      const nodeId1 = new NodeId(bytes1);
      const nodeId2 = new NodeId(bytes2);

      // WHEN
      const distance = calculateScalarDistance(nodeId1, nodeId2);

      // THEN
      // 255 (0xFF) in the most significant byte equals 255 * 2^(8*19) as a 160-bit number
      const expected = 255n * (1n << 152n);
      expect(distance).toBe(expected);
    });

    it("should be symmetric", () => {
      // GIVEN
      const nodeId1 = NodeId.random();
      const nodeId2 = NodeId.random();

      // WHEN
      const distance1to2 = calculateScalarDistance(nodeId1, nodeId2);
      const distance2to1 = calculateScalarDistance(nodeId2, nodeId1);

      // THEN
      expect(distance1to2).toBe(distance2to1);
    });
  });

  describe("compareDistances", () => {
    it("should return 0 when distances are equal", () => {
      // GIVEN
      const target = NodeId.random();
      const nodeId1 = NodeId.random();

      // WHEN
      const result = compareDistances(target, nodeId1, nodeId1);

      // THEN
      expect(result).toBe(0);
    });

    it("should return negative when first node is closer", () => {
      // GIVEN
      // Create nodes with a known relation
      const targetBytes = new Uint8Array(20).fill(0);
      targetBytes[0] = 0;

      const closerBytes = new Uint8Array(20).fill(0);
      closerBytes[0] = 1; // Distance of 1 in most significant byte

      const fartherBytes = new Uint8Array(20).fill(0);
      fartherBytes[0] = 2; // Distance of 2 in most significant byte

      // WHEN
      const target = new NodeId(targetBytes);
      const closerNode = new NodeId(closerBytes);
      const fartherNode = new NodeId(fartherBytes);

      // THEN
      expect(compareDistances(target, closerNode, fartherNode)).toBeLessThan(0);
    });

    it("should return positive when second node is closer", () => {
      // GIVEN
      // Create nodes with a known relation
      const targetBytes = new Uint8Array(20).fill(0);
      targetBytes[0] = 0;

      const closerBytes = new Uint8Array(20).fill(0);
      closerBytes[0] = 1; // Distance of 1 in most significant byte

      const fartherBytes = new Uint8Array(20).fill(0);
      fartherBytes[0] = 2; // Distance of 2 in most significant byte

      // WHEN
      const target = new NodeId(targetBytes);
      const closerNode = new NodeId(closerBytes);
      const fartherNode = new NodeId(fartherBytes);

      // THEN
      expect(compareDistances(target, fartherNode, closerNode)).toBeGreaterThan(
        0,
      );
    });

    it("should compare based on the first byte that differs", () => {
      // GIVEN
      const targetBytes = new Uint8Array(20).fill(0);

      const node1Bytes = new Uint8Array(20).fill(0);
      node1Bytes[0] = 1; // First byte differs
      node1Bytes[1] = 255; // Second byte differs more, but shouldn't matter

      const node2Bytes = new Uint8Array(20).fill(0);
      node2Bytes[0] = 2; // First byte differs more

      // WHEN
      const target = new NodeId(targetBytes);
      const node1 = new NodeId(node1Bytes);
      const node2 = new NodeId(node2Bytes);

      // THEN
      // node1 is closer because its first byte is closer
      expect(compareDistances(target, node1, node2)).toBeLessThan(0);
    });
  });

  describe("isWithinDistance", () => {
    it("should return true when node is within range", () => {
      // GIVEN
      // Create a target and node with distance less than maxDistance
      const targetBytes = new Uint8Array(20).fill(0);
      const nodeBytes = new Uint8Array(20).fill(0);
      nodeBytes[19] = 1; // Distance of 1 in least significant byte

      const target = new NodeId(targetBytes);
      const node = new NodeId(nodeBytes);

      // Distance is 1, max distance is 10
      const maxDistance = 10n;

      // WHEN
      const result = isWithinDistance(node, target, maxDistance);

      // THEN
      expect(result).toBe(true);
    });

    it("should return false when node is outside range", () => {
      // GIVEN
      // Create a target and node with distance greater than maxDistance
      const targetBytes = new Uint8Array(20).fill(0);
      const nodeBytes = new Uint8Array(20).fill(0);
      nodeBytes[19] = 20; // Distance of 20 in least significant byte

      const target = new NodeId(targetBytes);
      const node = new NodeId(nodeBytes);

      // Distance is 20, max distance is 10
      const maxDistance = 10n;

      // WHEN
      const result = isWithinDistance(node, target, maxDistance);

      // THEN
      expect(result).toBe(false);
    });

    it("should return true for identical nodes regardless of maxDistance", () => {
      // GIVEN
      const nodeId = NodeId.random();

      // WHEN
      const result = isWithinDistance(nodeId, nodeId, 0n);

      // THEN
      expect(result).toBe(true);
    });
  });

  describe("log2Distance", () => {
    it("should return -1 for identical NodeIds", () => {
      // GIVEN
      const nodeId = NodeId.random();

      // WHEN
      const distance = log2Distance(nodeId, nodeId);

      // THEN
      expect(distance).toBe(-1);
    });

    it("should return the position of the most significant bit that differs", () => {
      // GIVEN
      // Create two NodeIds where the MSB that differs is at a known position
      const bytes1 = new Uint8Array(20).fill(0);
      const bytes2 = new Uint8Array(20).fill(0);

      // Differ in the first bit of the first byte (bit position 0)
      bytes1[0] = 0b10000000;
      bytes2[0] = 0b00000000;

      const nodeId1 = new NodeId(bytes1);
      const nodeId2 = new NodeId(bytes2);

      // WHEN
      const distance = log2Distance(nodeId1, nodeId2);

      // THEN
      expect(distance).toBe(0);
    });

    it("should return correct value for difference in later position", () => {
      // GIVEN
      // Create two NodeIds where the MSB that differs is in the second byte
      const bytes1 = new Uint8Array(20).fill(0);
      const bytes2 = new Uint8Array(20).fill(0);

      // Differ in the first bit of the second byte (bit position 8)
      bytes1[1] = 0b10000000;
      bytes2[1] = 0b00000000;

      const nodeId1 = new NodeId(bytes1);
      const nodeId2 = new NodeId(bytes2);

      // WHEN
      const distance = log2Distance(nodeId1, nodeId2);

      // THEN
      expect(distance).toBe(8);
    });

    it("should return correct value for difference in later bit position", () => {
      // GIVEN
      // Create two NodeIds where the MSB that differs is the 3rd bit in the first byte
      const bytes1 = new Uint8Array(20).fill(0);
      const bytes2 = new Uint8Array(20).fill(0);

      // Differ in the 3rd bit of the first byte (bit position 2)
      bytes1[0] = 0b00100000;
      bytes2[0] = 0b00000000;

      const nodeId1 = new NodeId(bytes1);
      const nodeId2 = new NodeId(bytes2);

      // WHEN
      const distance = log2Distance(nodeId1, nodeId2);

      // THEN
      expect(distance).toBe(2);
    });
  });
});
