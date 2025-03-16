import { describe, expect, it } from "vitest";
import { createNodeFixture } from "../__fixtures__/createNode.fixture";

import { NodeId } from "../core";
import { RoutingTable } from "./routing-table";

describe("RoutingTable", () => {
  describe("#addNode", () => {
    it("should add a node to the routing table", () => {
      // GIVEN
      const localNodeId = NodeId.random();
      const routingTable = new RoutingTable(localNodeId);
      const node = createNodeFixture("01");

      // WHEN
      const nodesToPing = routingTable.addNode(node);

      // THEN
      expect(nodesToPing).toHaveLength(0);
      expect(routingTable.size()).toEqual(1);
      expect(routingTable.findNode(node.id)).toEqual(node);
    });

    it("should not add the local node to the routing table", () => {
      // GIVEN
      const localNodeId = NodeId.random();
      const routingTable = new RoutingTable(localNodeId);
      const node = createNodeFixture(localNodeId.toHex());

      // WHEN
      const nodesToPing = routingTable.addNode(node);

      // THEN
      expect(nodesToPing).toHaveLength(0);
      expect(routingTable.size()).toEqual(0);
      expect(routingTable.findNode(node.id)).toEqual(undefined);
    });

    it("should split the bucket when it becomes full and contains the local node range", () => {
      // GIVEN
      const localNodeId = NodeId.fromHex(
        "8000000000000000000000000000000000000000",
      );
      const routingTable = new RoutingTable(localNodeId, { k: 2 });

      // These will go to the "0..." bucket (opposite of local node)
      const node1 = createNodeFixture(
        "0100000000000000000000000000000000000000",
      );
      const node2 = createNodeFixture(
        "0200000000000000000000000000000000000000",
      );

      // This will go to the "1..." bucket (same as local node)
      const node3 = createNodeFixture(
        "9000000000000000000000000000000000000000",
      );

      routingTable.addNode(node1);
      routingTable.addNode(node2);

      // biome-ignore lint/suspicious/noExplicitAny: this is only for testing
      const bucketsSizeBeforeSplit = (routingTable as any).buckets.size;

      // WHEN
      const nodesToPing = routingTable.addNode(node3);

      // THEN
      expect(nodesToPing).toHaveLength(0);
      // biome-ignore lint/suspicious/noExplicitAny: this is only for testing
      expect((routingTable as any).buckets.size).toBe(2);
      expect(bucketsSizeBeforeSplit).toBe(1);
      expect(routingTable.findNode(node1.id)).toBeDefined();
      expect(routingTable.findNode(node2.id)).toBeDefined();
      expect(routingTable.findNode(node3.id)).toBeDefined();
    });
    it("should not split a bucket that doesn't contain the local node range", () => {
      // GIVEN
      const localNodeId = NodeId.fromHex(
        "8000000000000000000000000000000000000000",
      );
      const routingTable = new RoutingTable(localNodeId, { k: 2 });

      // Manually create a split situation where we already have both a 0 and 1 prefix bucket
      // biome-ignore lint/suspicious/noExplicitAny: this is only for testing
      const bucket0 = (routingTable as any).buckets.get(0);
      // biome-ignore lint/suspicious/noExplicitAny: this is only for testing
      (routingTable as any).buckets.delete(0);
      // biome-ignore lint/suspicious/noExplicitAny: this is only for testing
      (routingTable as any).buckets.set(0, bucket0); // "0..." prefix bucket
      // biome-ignore lint/suspicious/noExplicitAny: this is only for testing
      (routingTable as any).buckets.set(1, bucket0); // "1..." prefix bucket

      // This bucket contains node IDs starting with "0"
      const node1 = createNodeFixture(
        "0100000000000000000000000000000000000000",
      );
      const node2 = createNodeFixture(
        "0200000000000000000000000000000000000000",
      );
      const node3 = createNodeFixture(
        "0300000000000000000000000000000000000000",
      );

      routingTable.addNode(node1);
      routingTable.addNode(node2);

      // biome-ignore lint/suspicious/noExplicitAny: this is only for testing
      const bucketCountBefore = (routingTable as any).buckets.size;

      // WHEN
      const nodesToPing = routingTable.addNode(node3);

      // THEN
      expect(nodesToPing).toHaveLength(2);
      // biome-ignore lint/suspicious/noExplicitAny: this is only for testing
      expect((routingTable as any).buckets.size).toBe(bucketCountBefore);
      expect(routingTable.findNode(node3.id)).toBeUndefined();
    });

    it("should support multiple levels of bucket splitting", () => {
      // GIVEN
      const localNodeId = NodeId.fromHex(
        "8000000000000000000000000000000000000000",
      );
      const routingTable = new RoutingTable(localNodeId, { k: 2 });

      // First level: "0..." vs "1..."
      const node1 = createNodeFixture(
        "0100000000000000000000000000000000000000",
      );
      const node2 = createNodeFixture(
        "0200000000000000000000000000000000000000",
      );

      // Will cause first split
      const node3 = createNodeFixture(
        "9000000000000000000000000000000000000000",
      );

      // Second level: "10..." vs "11..."
      const node4 = createNodeFixture(
        "A000000000000000000000000000000000000000",
      ); // 10...

      // Will cause second split
      const node5 = createNodeFixture(
        "C000000000000000000000000000000000000000",
      ); // 11...

      // WHEN - First split
      routingTable.addNode(node1);
      routingTable.addNode(node2);
      routingTable.addNode(node3);

      // Should have 2 buckets now
      // biome-ignore lint/suspicious/noExplicitAny: this is only for testing
      const bucketCountAfterFirstSplit = (routingTable as any).buckets.size;

      // WHEN - Second split
      routingTable.addNode(node4);
      routingTable.addNode(node5);

      // THEN
      // Should have 3 buckets now (prefix 0, prefix 10, prefix 11)
      // biome-ignore lint/suspicious/noExplicitAny: this is only for testing
      const bucketCountAfterSecondSplit = (routingTable as any).buckets.size;

      expect(bucketCountAfterFirstSplit).toBe(2);
      expect(bucketCountAfterSecondSplit).toBe(3);

      // All nodes should be in the routing table
      expect(routingTable.findNode(node1.id)).toBeDefined();
      expect(routingTable.findNode(node2.id)).toBeDefined();
      expect(routingTable.findNode(node3.id)).toBeDefined();
      expect(routingTable.findNode(node4.id)).toBeDefined();
      expect(routingTable.findNode(node5.id)).toBeDefined();
    });
  });

  describe("#removeNode", () => {
    it("should remove a node from the routing table", () => {
      // GIVEN
      const localNodeId = NodeId.random();
      const routingTable = new RoutingTable(localNodeId);
      const node = createNodeFixture("01");

      routingTable.addNode(node);

      // WHEN
      const removed = routingTable.removeNode(node.id);

      // THEN
      expect(removed).toEqual(true);
      expect(routingTable.size()).toEqual(0);
      expect(routingTable.findNode(node.id)).toEqual(undefined);
    });

    it("should return false if the node was not found", () => {
      // GIVEN
      const localNodeId = NodeId.random();
      const routingTable = new RoutingTable(localNodeId);
      const node = createNodeFixture("01");

      // WHEN
      const removed = routingTable.removeNode(node.id);

      // THEN
      expect(removed).toEqual(false);
    });
  });

  describe("#findClosestNodes", () => {
    it("should return the closest nodes to a target node", () => {
      // GIVEN
      const localNodeId = NodeId.random();
      const routingTable = new RoutingTable(localNodeId);
      const targetId = NodeId.fromHex("0".repeat(NodeId.SIZE_IN_BYTES * 2));

      const node1 = createNodeFixture("01"); // closest to 0
      const node2 = createNodeFixture("02");
      const node3 = createNodeFixture("03"); // farthest from 0

      routingTable.addNode(node1);
      routingTable.addNode(node2);
      routingTable.addNode(node3);

      // WHEN
      const closestNodes = routingTable.findClosestNodes(targetId, 2);

      // THEN
      expect(closestNodes).toHaveLength(2);
      expect(closestNodes[0].id.equals(node1.id)).toBe(true);
      expect(closestNodes[1].id.equals(node2.id)).toBe(true);
    });
  });

  describe("#getAllNodes", () => {
    it("should return the nodes from the routing table", () => {
      // GIVEN
      const localNodeId = NodeId.random();
      const routingTable = new RoutingTable(localNodeId);

      const node1 = createNodeFixture("01");
      const node2 = createNodeFixture("02");

      routingTable.addNode(node1);
      routingTable.addNode(node2);

      // WHEN
      const allNodes = routingTable.getAllNodes();

      // THEN
      expect(allNodes).toHaveLength(2);
      expect(allNodes[0].id.equals(node1.id)).toBe(true);
      expect(allNodes[1].id.equals(node2.id)).toBe(true);
    });
  });

  describe("#updateNodeTimestamp", () => {
    it("should update the timestamp of a node", () => {
      // GIVEN
      const localNodeId = NodeId.random();
      const routingTable = new RoutingTable(localNodeId);
      const node = createNodeFixture("01");

      // Set an old timestamp
      node.lastSeen = Date.now() - 10000;
      routingTable.addNode(node);

      const originalTimestamp = routingTable.findNode(node.id)?.lastSeen;

      // WHEN
      routingTable.updateNodeTimestamp(node.id);

      // THEN
      const updatedNode = routingTable.findNode(node.id);
      // biome-ignore lint/style/noNonNullAssertion: only for testing
      expect(updatedNode?.lastSeen).toBeGreaterThan(originalTimestamp!);
    });
  });
});
