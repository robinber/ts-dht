import { describe, expect, it } from "vitest";
import { calculateDistance, compareDistances } from "../src/distance";
import { NodeId } from "../src/node-id";

describe("Distance functions", () => {
	describe("calculateDistance", () => {
		it("should return all zeros for identical NodeIds", () => {
			// GIVEN
			const id = NodeId.random();

			// WHEN
			const distance = calculateDistance(id, id);

			// THEN
			expect(distance.every((byte) => byte === 0)).toBe(true);
		});

		it("should calculate correct XOR distance", () => {
			// GIVEN
			const idA = NodeId.fromHex("0000000000000000000000000000000000000001");
			const idB = NodeId.fromHex("0000000000000000000000000000000000000003");

			// WHEN
			const distance = calculateDistance(idA, idB);

			// THEN
			expect(distance[distance.length - 1]).toBe(2); // XOR of 0x01 and 0x03 is 0x02
			for (let i = 0; i < distance.length - 1; i++) {
				expect(distance[i]).toBe(0);
			}
		});

		it("should be symmetric (d(a,b) = d(b,a))", () => {
			// GIVEN
			const idA = NodeId.random();
			const idB = NodeId.random();

			// WHEN
			const distanceAB = calculateDistance(idA, idB);
			const distanceBA = calculateDistance(idB, idA);

			// THEN
			for (let i = 0; i < distanceAB.length; i++) {
				expect(distanceAB[i]).toBe(distanceBA[i]);
			}
		});
	});

	describe("compareDistances", () => {
		it("should return 0 for identical NodeIds", () => {
			// GIVEN
			const target = NodeId.random();
			const id = NodeId.random();

			// WHEN
			const result = compareDistances(target, id, id);

			// THEN
			expect(result).toBe(0);
		});

		it("should return negative when first NodeId is closer", () => {
			// GIVEN
			const target = NodeId.fromHex("0000000000000000000000000000000000000000");
			const closer = NodeId.fromHex("0000000000000000000000000000000000000001");
			const farther = NodeId.fromHex(
				"0000000000000000000000000000000000000002",
			);

			// WHEN
			const result = compareDistances(target, closer, farther);

			// THEN
			expect(result).toBe(-1);
		});

		it("should return positive when second NodeId is closer", () => {
			// GIVEN
			const target = NodeId.fromHex("0000000000000000000000000000000000000000");
			const farther = NodeId.fromHex(
				"0000000000000000000000000000000000000003",
			);
			const closer = NodeId.fromHex("0000000000000000000000000000000000000001");

			// WHEN
			const result = compareDistances(target, farther, closer);

			// THEN
			expect(result).toBe(2); // 0x03 - 0x01 = 2
		});

		it("should compare based on the first differing byte", () => {
			// GIVEN
			const target = NodeId.fromHex("0000000000000000000000000000000000000000");
			// First byte is different (closer), but later bytes are farther
			const idA = NodeId.fromHex("0100000000000000000000000000000000000000");
			// First byte is different (farther), but later bytes are closer
			const idB = NodeId.fromHex("0200000000000000000000000000000000000000");

			// WHEN
			const result = compareDistances(target, idA, idB);

			// THEN
			expect(result).toBeLessThan(0); // idA should be considered closer
		});

		it("should handle NodeIds with multiple differing bytes", () => {
			// GIVEN
			const target = NodeId.fromHex("0000000000000000000000000000000000000000");
			const idA = NodeId.fromHex("0100000000000000000000000000000000000010"); // Diff in first and last byte
			const idB = NodeId.fromHex("0200000000000000000000000000000000000005"); // Diff in first and last byte

			// WHEN
			const result = compareDistances(target, idA, idB);

			// THEN
			expect(result).toBeLessThan(0); // First byte's difference takes precedence
		});
	});
});
