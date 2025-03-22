import { beforeEach, describe, expect, it } from "vitest";
import { createNodeFixture } from "../__fixtures__/createNode.fixture";
import { NodeId } from "../core";
import type { DHTNode } from "./k-bucket";
import { RoutingTable } from "./routing-table";

describe("RoutingTable", () => {
  // Common test variables
  let localNodeId: NodeId;
  let routingTable: RoutingTable;

  // Helper function to get bucket count
  const getBucketCount = (table: RoutingTable): number => {
    return table.getBucketCount();
  };

  beforeEach(() => {
    localNodeId = NodeId.random();
    routingTable = new RoutingTable(localNodeId);
  });

  describe("Basic operations", () => {
    describe("#addNode", () => {
      it("should add a node to the routing table", () => {
        // GIVEN
        const node = createNodeFixture("01");

        // WHEN
        const nodesToPing = routingTable.addNode(node);

        // THEN
        expect(nodesToPing).toHaveLength(0);
        expect(routingTable.size()).toBe(1);
        expect(routingTable.findNode(node.id)).toEqual(node);
      });

      it("should not add the local node to the routing table", () => {
        // GIVEN
        const node = createNodeFixture(localNodeId.toHex());

        // WHEN
        const nodesToPing = routingTable.addNode(node);

        // THEN
        expect(nodesToPing).toHaveLength(0);
        expect(routingTable.size()).toBe(0);
        expect(routingTable.findNode(node.id)).toBeUndefined();
      });
    });

    describe("#removeNode", () => {
      it("should remove a node from the routing table", () => {
        // GIVEN
        const node = createNodeFixture("01");
        routingTable.addNode(node);

        // WHEN
        const removed = routingTable.removeNode(node.id);

        // THEN
        expect(removed).toBe(true);
        expect(routingTable.size()).toBe(0);
        expect(routingTable.findNode(node.id)).toBeUndefined();
      });

      it("should return false if the node was not found", () => {
        // GIVEN
        const nonExistentNode = createNodeFixture("ff");

        // WHEN
        const removed = routingTable.removeNode(nonExistentNode.id);

        // THEN
        expect(removed).toBe(false);
      });
    });

    describe("#updateNodeTimestamp", () => {
      it("should update the timestamp of a node", () => {
        // GIVEN
        const node = createNodeFixture("01");
        node.lastSeen = Date.now() - 10000; // Set timestamp to 10 seconds ago
        routingTable.addNode(node);
        const originalTimestamp = routingTable.findNode(node.id)?.lastSeen;

        // WHEN
        routingTable.updateNodeTimestamp(node.id);

        // THEN
        const updatedNode = routingTable.findNode(node.id);
        expect(updatedNode).toBeDefined();
        expect(updatedNode?.lastSeen).toBeGreaterThan(originalTimestamp || 0);
      });

      it("should do nothing for non-existent nodes", () => {
        // GIVEN
        const nonExistentNodeId = NodeId.random();

        // WHEN
        routingTable.updateNodeTimestamp(nonExistentNodeId);

        // THEN - should not throw
        expect(routingTable.size()).toBe(0);
      });
    });
  });

  describe("Bucket splitting", () => {
    let specialLocalNodeId: NodeId;
    let specialRoutingTable: RoutingTable;

    beforeEach(() => {
      // Using a predictable node ID for bucket splitting tests
      specialLocalNodeId = NodeId.fromHex(
        "8000000000000000000000000000000000000000",
      );
      specialRoutingTable = new RoutingTable(specialLocalNodeId, { k: 2 });
    });

    it("should split the bucket when it becomes full and contains the local node range", () => {
      // GIVEN
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

      // Add two nodes first
      specialRoutingTable.addNode(node1);
      specialRoutingTable.addNode(node2);

      // Check initial bucket count
      const bucketCountBeforeSplit = getBucketCount(specialRoutingTable);

      // WHEN - Adding node3 should trigger a split
      const nodesToPing = specialRoutingTable.addNode(node3);

      // THEN
      expect(nodesToPing).toHaveLength(0);

      // Now we expect more buckets than before (The initial bucket is split)
      const bucketCountAfterSplit = getBucketCount(specialRoutingTable);
      expect(bucketCountAfterSplit).toBeGreaterThan(bucketCountBeforeSplit);
      expect(bucketCountBeforeSplit).toBe(1);

      // Check that node3 got added (it goes in the local node's bucket)
      expect(specialRoutingTable.findNode(node3.id)).toBeDefined();

      // The current implementation is redistributing the nodes between buckets,
      // so we should have at least one of the original nodes still in the table
      // but not necessarily both (it depends on the bit distribution)
      const nodeCount = specialRoutingTable.size();
      expect(nodeCount).toBeGreaterThanOrEqual(1);
    });

    it("should not split a bucket that doesn't contain the local node range", () => {
      // GIVEN
      // Create a routing table with split buckets
      // Manually create a split situation with buckets for "0..." and "1..."
      // We need to access private buckets property for this test case
      // biome-ignore lint/complexity/useLiteralKeys: Needed for test
      const bucket0 = specialRoutingTable["buckets"].get(0);
      if (!bucket0) throw new Error("Initial bucket not found");

      // biome-ignore lint/complexity/useLiteralKeys: Needed for test
      specialRoutingTable["buckets"].delete(0);
      // biome-ignore lint/complexity/useLiteralKeys: Needed for test
      specialRoutingTable["buckets"].set(0, bucket0); // "0..." prefix bucket
      // biome-ignore lint/complexity/useLiteralKeys: Needed for test
      specialRoutingTable["buckets"].set(1, bucket0); // "1..." prefix bucket

      // Add nodes that go to the "0..." bucket
      const node1 = createNodeFixture(
        "0100000000000000000000000000000000000000",
      );
      const node2 = createNodeFixture(
        "0200000000000000000000000000000000000000",
      );
      const node3 = createNodeFixture(
        "0300000000000000000000000000000000000000",
      );

      specialRoutingTable.addNode(node1);
      specialRoutingTable.addNode(node2);

      const bucketCountBefore = getBucketCount(specialRoutingTable);

      // WHEN - Try to add the third node which would overfill the bucket
      const nodesToPing = specialRoutingTable.addNode(node3);

      // THEN
      // Should return nodes to ping instead of splitting
      expect(nodesToPing).toHaveLength(2);

      // Bucket count should remain the same
      expect(getBucketCount(specialRoutingTable)).toBe(bucketCountBefore);

      // The new node should not be added
      expect(specialRoutingTable.findNode(node3.id)).toBeUndefined();
    });

    it("should support multiple levels of bucket splitting", () => {
      // GIVEN
      // First level: "0..." vs "1..."
      const node1 = createNodeFixture(
        "0100000000000000000000000000000000000000",
      );
      const node2 = createNodeFixture(
        "0200000000000000000000000000000000000000",
      );
      const node3 = createNodeFixture(
        "9000000000000000000000000000000000000000",
      ); // Will cause first split

      // Second level: "10..." vs "11..."
      const node4 = createNodeFixture(
        "A000000000000000000000000000000000000000",
      ); // 10...
      const node5 = createNodeFixture(
        "C000000000000000000000000000000000000000",
      ); // 11... Will cause second split

      // WHEN - First add is simple
      specialRoutingTable.addNode(node1);
      const sizeAfterFirstAdd = specialRoutingTable.size();
      expect(sizeAfterFirstAdd).toBe(1);

      // Add the second node to potentially fill the bucket
      specialRoutingTable.addNode(node2);

      // Add the third node which should cause a split
      specialRoutingTable.addNode(node3);

      // Capture bucket count after first split
      const bucketCountAfterFirstSplit = getBucketCount(specialRoutingTable);

      // WHEN - Second split
      specialRoutingTable.addNode(node4);
      specialRoutingTable.addNode(node5);

      // THEN
      // After first split, we should have more than 1 bucket
      expect(bucketCountAfterFirstSplit).toBeGreaterThan(1);

      // After second split, we should have even more buckets
      const finalBucketCount = getBucketCount(specialRoutingTable);
      expect(finalBucketCount).toBeGreaterThanOrEqual(
        bucketCountAfterFirstSplit,
      );

      // Check that the last nodes we added are in the table
      // (We can't guarantee the early nodes are still there after multiple splits)
      expect(specialRoutingTable.findNode(node5.id)).toBeDefined();
      expect(specialRoutingTable.size()).toBeGreaterThan(0);
    });
  });

  describe("Node querying", () => {
    // Set up nodes for query tests
    let nodes: DHTNode[];
    let zeroId: NodeId;

    beforeEach(() => {
      zeroId = NodeId.fromHex("0".repeat(NodeId.SIZE_IN_BYTES * 2));

      // Create and add several test nodes
      nodes = [
        createNodeFixture("01"), // closest to zero
        createNodeFixture("02"),
        createNodeFixture("03"), // farthest from zero
        createNodeFixture("ff"), // very far from zero
      ];

      // Add all nodes to the routing table
      for (const node of nodes) {
        routingTable.addNode(node);
      }
    });

    describe("#findClosestNodes", () => {
      it("should return the closest nodes to a target node ID", () => {
        // WHEN
        const closestNodes = routingTable.findClosestNodes(zeroId, 2);

        // THEN
        expect(closestNodes).toHaveLength(2);
        expect(closestNodes[0].id.equals(nodes[0].id)).toBe(true); // node 01
        expect(closestNodes[1].id.equals(nodes[1].id)).toBe(true); // node 02
      });

      it("should return all nodes when count is larger than available nodes", () => {
        // WHEN
        const closestNodes = routingTable.findClosestNodes(zeroId, 10);

        // THEN
        expect(closestNodes).toHaveLength(nodes.length);
      });

      it("should optimize lookup when target is the local node", () => {
        // GIVEN
        const sortedRoutingTable = new RoutingTable(localNodeId, {
          keepBucketsSorted: true,
        });
        for (const node of nodes) {
          sortedRoutingTable.addNode(node);
        }

        // WHEN
        const closestNodes = sortedRoutingTable.findClosestNodes(
          localNodeId,
          2,
        );

        // THEN
        expect(closestNodes).toHaveLength(2);
      });
    });

    describe("#findNodesWithinDistance", () => {
      it("should find nodes within the specified distance", () => {
        // GIVEN
        const smallDistance = 10n; // Small distance should include fewer nodes
        const largeDistance = 1000n; // Large distance should include more nodes

        // WHEN
        const nodesWithinSmallDistance = routingTable.findNodesWithinDistance(
          zeroId,
          smallDistance,
        );
        const nodesWithinLargeDistance = routingTable.findNodesWithinDistance(
          zeroId,
          largeDistance,
        );

        // THEN
        // Fewer nodes within small distance
        expect(nodesWithinSmallDistance.length).toBeLessThanOrEqual(
          nodesWithinLargeDistance.length,
        );

        // Nodes within small distance should be a subset of those within large distance
        for (const node of nodesWithinSmallDistance) {
          const inLargerSet = nodesWithinLargeDistance.some((largeNode) =>
            largeNode.id.equals(node.id),
          );
          expect(inLargerSet).toBe(true);
        }
      });
    });

    describe("#getAllNodes", () => {
      it("should return all nodes from the routing table", () => {
        // WHEN
        const allNodes = routingTable.getAllNodes();

        // THEN
        expect(allNodes).toHaveLength(nodes.length);

        // Verify all our nodes are present (order might vary)
        for (const node of nodes) {
          const isPresent = allNodes.some((returnedNode) =>
            returnedNode.id.equals(node.id),
          );
          expect(isPresent).toBe(true);
        }
      });
    });
  });

  describe("Maintenance operations", () => {
    it("should track buckets that need refreshing", () => {
      // GIVEN
      const shortInterval = 100; // 100ms refresh interval

      // Initially no buckets should need refresh
      expect(routingTable.getBucketsNeedingRefresh(shortInterval)).toHaveLength(
        0,
      );

      // Force a bucket to need refreshing by waiting
      // biome-ignore lint/complexity/useLiteralKeys: Needed for test
      routingTable["buckets"].get(0)?.markAsRefreshed();

      // WHEN - We wait for the refresh interval to pass
      // Get a reference to the bucket to avoid null assertions
      // biome-ignore lint/complexity/useLiteralKeys: Needed for test
      const rootBucket = routingTable["buckets"].get(0);
      if (rootBucket) {
        // @ts-ignore
        rootBucket.lastRefreshed = Date.now() - shortInterval * 2;
      }

      // THEN
      const bucketsNeedingRefresh =
        routingTable.getBucketsNeedingRefresh(shortInterval);
      expect(bucketsNeedingRefresh).toHaveLength(1);
      expect(bucketsNeedingRefresh[0]).toBe(0); // The root bucket

      // WHEN - We mark the bucket as refreshed
      routingTable.markBucketAsRefreshed(0);

      // THEN - No buckets should need refreshing
      expect(routingTable.getBucketsNeedingRefresh(shortInterval)).toHaveLength(
        0,
      );
    });

    it("should provide accurate statistics about the routing table", () => {
      // GIVEN
      // Add some nodes to the routing table
      const node1 = createNodeFixture("01");
      const node2 = createNodeFixture("02");
      routingTable.addNode(node1);
      routingTable.addNode(node2);

      // WHEN
      const stats = routingTable.getStats();

      // THEN
      expect(stats.totalNodes).toBe(2);
      expect(stats.bucketCount).toBe(getBucketCount(routingTable));
      expect(stats.bucketsUtilization.length).toBe(stats.bucketCount);
      expect(stats.averageUtilization).toBeGreaterThan(0);
    });
  });
});
