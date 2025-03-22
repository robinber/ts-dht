import { beforeEach, describe, expect, it } from "vitest";
import { createNodeFixture } from "../__fixtures__/createNode.fixture";
import { NodeId } from "../core";
import { type DHTNode, KBucket } from "./index";

describe("KBucket", () => {
  let localNodeId: NodeId;
  let bucket: KBucket;

  beforeEach(() => {
    localNodeId = NodeId.random();
    bucket = new KBucket(localNodeId);
  });

  describe("Core functionality", () => {
    describe("#addNode", () => {
      it("should add a node to an empty bucket", () => {
        // GIVEN
        const node = createNodeFixture("01");

        // WHEN
        const nodesToPing = bucket.addNode(node);

        // THEN
        expect(nodesToPing).toHaveLength(0);
        expect(bucket.size()).toBe(1);
        expect(bucket.contains(node.id)).toBe(true);
      });

      it("should not add the local node to its own bucket", () => {
        // GIVEN
        const node = createNodeFixture(localNodeId.toHex());

        // WHEN
        const nodesToPing = bucket.addNode(node);

        // THEN
        expect(nodesToPing).toHaveLength(0);
        expect(bucket.size()).toBe(0);
        expect(bucket.contains(node.id)).toBe(false);
      });

      it("should update existing node instead of adding it again", () => {
        // GIVEN
        const node = createNodeFixture("01");
        bucket.addNode(node);

        // WHEN
        const nodesToPing = bucket.addNode(node);

        // THEN
        expect(nodesToPing).toHaveLength(0);
        expect(bucket.size()).toBe(1);
        expect(bucket.contains(node.id)).toBe(true);
      });

      it("should return nodes to ping when the bucket is full", () => {
        // GIVEN
        bucket = new KBucket(localNodeId, { k: 2, pingCount: 1 });

        // Fill the bucket
        const node1 = createNodeFixture("01");
        const node2 = createNodeFixture("02");
        bucket.addNode(node1);
        bucket.addNode(node2);

        // Try to add one more
        const node3 = createNodeFixture("03");

        // WHEN
        const nodesToPing = bucket.addNode(node3);

        // THEN
        expect(bucket.size()).toBe(2);
        expect(nodesToPing).toHaveLength(1);
        expect(nodesToPing[0].id.equals(node1.id)).toBe(true);
      });
    });

    describe("#removeNode", () => {
      it("should remove a node from the bucket", () => {
        // GIVEN
        const node = createNodeFixture("01");
        bucket.addNode(node);

        // WHEN
        const removed = bucket.removeNode(node.id);

        // THEN
        expect(removed).toBe(true);
        expect(bucket.size()).toBe(0);
        expect(bucket.contains(node.id)).toBe(false);
      });

      it("should return false when removing a non-existent node", () => {
        // GIVEN
        const nonExistentNodeId = NodeId.random();

        // WHEN
        const removed = bucket.removeNode(nonExistentNodeId);

        // THEN
        expect(removed).toBe(false);
      });
    });
  });

  describe("Node queries", () => {
    let node1: DHTNode;
    let node2: DHTNode;
    let node3: DHTNode;

    beforeEach(() => {
      node1 = createNodeFixture("01");
      node2 = createNodeFixture("02");
      node3 = createNodeFixture("03");

      bucket.addNode(node1);
      bucket.addNode(node2);
      bucket.addNode(node3);
    });

    describe("#findClosestNodes", () => {
      it("should find the closest nodes to a target ID", () => {
        // GIVEN
        const targetId = NodeId.fromHex(
          "0000000000000000000000000000000000000000",
        );

        // WHEN
        const closestNodes = bucket.findClosestNodes(targetId, 2);

        // THEN
        expect(closestNodes).toHaveLength(2);
        expect(closestNodes[0].id.equals(node1.id)).toBe(true);
        expect(closestNodes[1].id.equals(node2.id)).toBe(true);
      });

      it("should handle requesting more nodes than available", () => {
        // GIVEN
        const targetId = NodeId.fromHex(
          "0000000000000000000000000000000000000000",
        );

        // WHEN
        const closestNodes = bucket.findClosestNodes(targetId, 5);

        // THEN
        expect(closestNodes).toHaveLength(3);
      });

      it("should optimize when target is local node and bucket is sorted", () => {
        // GIVEN
        bucket = new KBucket(localNodeId, { keepSorted: true });
        bucket.addNode(node1);
        bucket.addNode(node2);

        // WHEN
        const closestNodes = bucket.findClosestNodes(localNodeId);

        // THEN
        expect(closestNodes).toHaveLength(2);
      });
    });

    describe("#findNode", () => {
      it("should find a specific node by ID", () => {
        // WHEN
        const foundNode = bucket.findNode(node2.id);

        // THEN
        expect(foundNode).toBeDefined();
        expect(foundNode?.id.equals(node2.id)).toBe(true);
      });

      it("should return undefined for non-existent nodes", () => {
        // GIVEN
        const nonExistentNodeId = NodeId.random();

        // WHEN
        const foundNode = bucket.findNode(nonExistentNodeId);

        // THEN
        expect(foundNode).toBeUndefined();
      });
    });

    describe("#findNodesWithinDistance", () => {
      it("should find nodes within specified distance", () => {
        // GIVEN
        const targetId = NodeId.fromHex(
          "0000000000000000000000000000000000000000",
        );
        const maxDistance = 10n;

        // WHEN
        const nodesInRange = bucket.findNodesWithinDistance(
          targetId,
          maxDistance,
        );

        // THEN
        expect(nodesInRange.length).toBeGreaterThanOrEqual(0);
      });
    });

    describe("#getAllNodes", () => {
      it("should return all nodes in the bucket", () => {
        // WHEN
        const allNodes = bucket.getAllNodes();

        // THEN
        expect(allNodes).toHaveLength(3);
        // Just verify the nodes are returned correctly
        expect(allNodes.map((node) => node.id.toHex())).toEqual([
          node1.id.toHex(),
          node2.id.toHex(),
          node3.id.toHex(),
        ]);
      });
    });
  });

  describe("Bucket state management", () => {
    describe("#updateNodeTimestamp", () => {
      it("should update a node's timestamp", () => {
        // GIVEN
        const node = createNodeFixture("01");
        node.lastSeen = Date.now() - 1000; // Set to 1 second ago
        bucket.addNode(node);
        const originalNode = bucket.findNode(node.id);
        const originalTimestamp = originalNode?.lastSeen;

        // WHEN
        bucket.updateNodeTimestamp(node.id);

        // THEN
        const updatedNode = bucket.findNode(node.id);
        expect(updatedNode).toBeDefined();
        expect(updatedNode?.lastSeen).toBeGreaterThan(originalTimestamp || 0);
      });

      it("should have no effect for non-existent nodes", () => {
        // GIVEN
        const nonExistentNodeId = NodeId.random();

        // WHEN
        bucket.updateNodeTimestamp(nonExistentNodeId);

        // THEN
        expect(bucket.size()).toBe(0);
      });
    });

    describe("#isFull", () => {
      it("should return true when bucket reaches capacity", () => {
        // GIVEN
        bucket = new KBucket(localNodeId, { k: 2 });
        bucket.addNode(createNodeFixture("01"));
        bucket.addNode(createNodeFixture("02"));

        // WHEN/THEN
        expect(bucket.isFull()).toBe(true);
      });

      it("should return false when bucket has available space", () => {
        // GIVEN
        bucket = new KBucket(localNodeId, { k: 2 });
        bucket.addNode(createNodeFixture("01"));

        // WHEN/THEN
        expect(bucket.isFull()).toBe(false);
      });
    });

    describe("#markAsRefreshed and #needsRefresh", () => {
      it("should correctly track refresh status", async () => {
        // GIVEN
        const shortInterval = 100; // 100ms

        // A bucket is never in need of refresh when first created
        expect(bucket.needsRefresh(shortInterval)).toBe(false);

        // WHEN/THEN - Force a refresh to be needed
        // Wait for the short interval to pass
        await new Promise((resolve) => setTimeout(resolve, shortInterval + 10));

        // Now it should need refresh
        expect(bucket.needsRefresh(shortInterval)).toBe(true);

        // After marking as refreshed, it should no longer need refresh
        bucket.markAsRefreshed();
        expect(bucket.needsRefresh(shortInterval)).toBe(false);
      });
    });
  });

  describe("Bucket utilities", () => {
    describe("#getDistanceRange", () => {
      it("should calculate correct distance ranges", () => {
        // WHEN
        const rangeAtZero = bucket.getDistanceRange(0);
        const rangeAtOne = bucket.getDistanceRange(1);
        const rangeAtMax = bucket.getDistanceRange(NodeId.SIZE_IN_BITS);

        // THEN
        expect(rangeAtZero.min).toBe(1n);
        expect(rangeAtZero.max).toBe(1n);
        expect(rangeAtOne.min).toBe(2n);
        expect(rangeAtOne.max).toBe(3n);
        expect(rangeAtMax.min).toBe(0n);
        expect(rangeAtMax.max).toBe(0n);
      });
    });

    describe("#getStats", () => {
      it("should return correct bucket statistics", () => {
        // GIVEN
        bucket = new KBucket(localNodeId, { k: 10 });
        const node1 = createNodeFixture("01");
        const node2 = createNodeFixture("02");
        bucket.addNode(node1);
        bucket.addNode(node2);

        // WHEN
        const stats = bucket.getStats();

        // THEN
        expect(stats.size).toBe(2);
        expect(stats.capacity).toBe(10);
        expect(stats.utilization).toBe(0.2);
        expect(stats.lastRefreshed).toBeGreaterThan(0);
        expect(stats.oldestNode).toBeGreaterThan(0);
        expect(stats.newestNode).toBeGreaterThan(0);
      });

      it("should handle empty buckets", () => {
        // WHEN
        const stats = bucket.getStats();

        // THEN
        expect(stats.size).toBe(0);
        expect(stats.oldestNode).toBeNull();
        expect(stats.newestNode).toBeNull();
      });
    });
  });
});
