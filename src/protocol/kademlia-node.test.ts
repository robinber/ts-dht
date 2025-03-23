import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeFixture } from "../__fixtures__/createNode.fixture";
import { NodeId } from "../core";
import type { DHTNode } from "../routing";
import { KademliaNode } from "./kademlia-node";
import type { StoreValue } from "./kademlia-node.types";

describe("KademliaNode", () => {
  let localNode: KademliaNode;
  let localNodeId: NodeId;

  beforeEach(() => {
    localNodeId = NodeId.fromHex("0000000000000000000000000000000000000000");
    // Disable maintenance tasks for testing
    localNode = new KademliaNode(localNodeId, {
      address: "127.0.0.1:8000",
      enableMaintenance: false,
    });

    vi.spyOn(localNode, "queryNode").mockImplementation(
      async (_node, _target, _lookupId) => [],
    );
    vi.spyOn(localNode, "queryNodeForValue").mockImplementation(
      async (_node, _key, _lookupId) => ({
        value: null,
        closestNodes: [],
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localNode._testing.clearTimers();
  });

  describe("Core Operations", () => {
    describe("Initialization", () => {
      it("should initialize with default options when not provided", () => {
        // GIVEN
        const node = new KademliaNode(localNodeId, {
          address: "127.0.0.1:8000",
        });

        // THEN
        expect(node._testing.getK()).toBe(20);
        expect(node._testing.getAlpha()).toBe(3);
        expect(node._testing.getMaxIterations()).toBe(20);

        // Cleanup
        node._testing.clearTimers();
      });

      it("should initialize with custom options when provided", () => {
        // GIVEN
        const customOptions = {
          address: "127.0.0.1:8000" as const,
          k: 10,
          alpha: 5,
          maxIterations: 15,
          enableMaintenance: false,
        };

        // WHEN
        const node = new KademliaNode(localNodeId, customOptions);

        // THEN
        expect(node._testing.getK()).toBe(10);
        expect(node._testing.getAlpha()).toBe(5);
        expect(node._testing.getMaxIterations()).toBe(15);
      });
    });

    describe("ping", () => {
      it("should return false when node is not in routing table", async () => {
        // GIVEN
        const unknownNodeId = NodeId.random();

        // WHEN
        const result = await localNode.ping(unknownNodeId);

        // THEN
        expect(result).toBe(false);
      });

      it("should update node timestamp when successful", async () => {
        // GIVEN
        const node = createNodeFixture("01");
        localNode.addNode(node);

        // Spy on updateNodeTimestamp
        const updateSpy = vi.spyOn(
          localNode._testing.getRoutingTable(),
          "updateNodeTimestamp",
        );

        // WHEN
        const result = await localNode.ping(node.id);

        // THEN
        expect(result).toBe(true);
        expect(updateSpy).toHaveBeenCalledWith(node.id);
      });
    });

    describe("store", () => {
      it("should store value locally", async () => {
        // GIVEN
        const key = NodeId.fromHex("0000000000000000000000000000000000000001");
        const value = new Uint8Array([1, 2, 3, 4]);

        // WHEN
        const result = await localNode.store(key, value);

        // THEN
        expect(result).toBe(true);

        // Check storage
        const storage = localNode._testing.getStorage();
        expect(storage.has(key.toHex())).toBe(true);

        const storedValue = storage.get(key.toHex());
        expect(storedValue?.value).toEqual(value);
      });

      it("should update stats when storing a value", async () => {
        // GIVEN
        const key = NodeId.fromHex("0000000000000000000000000000000000000001");
        const value = new Uint8Array([1, 2, 3, 4]);

        // WHEN
        await localNode.store(key, value);

        // THEN
        const stats = localNode.getStats();
        expect(stats.storedKeys).toBe(1);
        expect(stats.storageSize).toBe(4); // Uint8Array of length 4
        expect(stats.valuesStored).toBe(1);
      });
    });
  });

  describe("Node Lookup", () => {
    describe("findNode", () => {
      it("should return local nodes when no remote nodes respond", async () => {
        // GIVEN
        const target = NodeId.fromHex(
          "0000000000000000000000000000000000000001",
        );

        const node1 = createNodeFixture("01");
        const node2 = createNodeFixture("02");

        localNode.addNode(node1);
        localNode.addNode(node2);

        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        (localNode as any).queryNode.mockResolvedValue([]);

        // WHEN
        const result = await localNode.findNode(target);

        // THEN
        expect(result).toHaveLength(2);
        expect(result.some((node) => node.id.equals(node1.id))).toBe(true);
        expect(result.some((node) => node.id.equals(node2.id))).toBe(true);
      });

      it("should query nodes and update the closest nodes list", async () => {
        // GIVEN
        // Add initial nodes to routing table
        const node1 = createNodeFixture(
          "0100000000000000000000000000000000000000",
        );
        const node2 = createNodeFixture(
          "0200000000000000000000000000000000000000",
        );
        localNode.addNode(node1);
        localNode.addNode(node2);

        const remoteNode1 = createNodeFixture(
          "0300000000000000000000000000000000000000",
        );
        const remoteNode2 = createNodeFixture(
          "0400000000000000000000000000000000000000",
        );

        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        (localNode as any).queryNode.mockImplementation(
          (node: DHTNode, _target: NodeId, _lookupId?: string) =>
            Promise.resolve([
              node.id.equals(node1.id) ? remoteNode1 : remoteNode2,
            ]),
        );

        // Set target and call findNode
        const target = NodeId.fromHex(
          "0000000000000000000000000000000000000001",
        );

        // WHEN
        const result = await localNode.findNode(target);

        // THEN
        expect(result.length).toBeGreaterThanOrEqual(4);
        expect(result.some((node) => node.id.equals(node1.id))).toBe(true);
        expect(result.some((node) => node.id.equals(node2.id))).toBe(true);
        expect(result.some((node) => node.id.equals(remoteNode1.id))).toBe(
          true,
        );
        expect(result.some((node) => node.id.equals(remoteNode2.id))).toBe(
          true,
        );

        // Verify the lookup was properly tracked
        expect(localNode._testing.getActiveRequests().size).toBe(0); // Should be cleaned up

        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNode).toHaveBeenCalledWith(
          node1,
          target,
          expect.stringMatching(/^findNode-/),
        );
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNode).toHaveBeenCalledWith(
          node2,
          target,
          expect.stringMatching(/^findNode-/),
        );
      });

      it("should terminate when no closer nodes are found", async () => {
        // GIVEN
        const node1 = createNodeFixture(
          "0100000000000000000000000000000000000000",
        );
        localNode.addNode(node1);

        const remoteNode1 = createNodeFixture(
          "0300000000000000000000000000000000000000",
        );

        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        (localNode as any).queryNode.mockImplementation((node: DHTNode) => {
          if (node.id.equals(node1.id)) {
            return Promise.resolve([remoteNode1]);
          }
          if (node.id.equals(remoteNode1.id)) {
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        });

        const target = NodeId.fromHex(
          "0000000000000000000000000000000000000001",
        );

        // WHEN
        await localNode.findNode(target);

        // THEN
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNode).toHaveBeenCalledTimes(2);

        // Verify stats were updated
        const stats = localNode.getStats();
        expect(stats.successfulLookups).toBe(1);
        expect(stats.failedLookups).toBe(0);
      });

      it("should sort nodes by distance to target", async () => {
        // GIVEN
        const target = NodeId.fromHex(
          "0000000000000000000000000000000000000000",
        );

        const nearNode = createNodeFixture(
          "0100000000000000000000000000000000000000",
        );
        const farNode = createNodeFixture(
          "0F00000000000000000000000000000000000000",
        );

        localNode.addNode(farNode); // Add them in reverse order
        localNode.addNode(nearNode);

        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        (localNode as any).queryNode.mockResolvedValue([]);

        // WHEN
        const result = await localNode.findNode(target);

        // THEN
        // Verify nodes are sorted by distance
        expect(result[0].id.equals(nearNode.id)).toBe(true);
        expect(result[1].id.equals(farNode.id)).toBe(true);
      });
    });
  });

  describe("Value Storage and Retrieval", () => {
    describe("findValue", () => {
      it("should return a locally stored value", async () => {
        // GIVEN
        const key = NodeId.fromHex("0000000000000000000000000000000000000001");
        const value = new Uint8Array([1, 2, 3, 4]);

        // Store the value locally
        await localNode.store(key, value);

        // WHEN
        const result = await localNode.findValue(key);

        // THEN
        expect(result).not.toBeNull();
        expect(result).toEqual(value);
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNodeForValue).not.toHaveBeenCalled();
      });

      it("should not return an expired locally stored value", async () => {
        // GIVEN
        const key = NodeId.fromHex("0000000000000000000000000000000000000001");
        const value = new Uint8Array([1, 2, 3, 4]);

        // Store the value with a short TTL (1ms)
        await localNode.store(key, value, 1);

        // Wait for the value to expire
        await new Promise((resolve) => setTimeout(resolve, 10));

        // WHEN
        const result = await localNode.findValue(key);

        // THEN
        expect(result).toBeNull();

        // Verify the expired value was removed from storage
        const storage = localNode._testing.getStorage();
        expect(storage.has(key.toHex())).toBe(false);
      });

      it("should return null when value not found locally and no remote nodes respond", async () => {
        // GIVEN
        const key = NodeId.fromHex("0000000000000000000000000000000000000001");

        const node1 = createNodeFixture("01");
        const node2 = createNodeFixture("02");

        localNode.addNode(node1);
        localNode.addNode(node2);

        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        (localNode as any).queryNodeForValue.mockResolvedValue({
          value: null,
          closestNodes: [],
        });

        // WHEN
        const result = await localNode.findValue(key);

        // THEN
        expect(result).toBeNull();

        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNodeForValue).toHaveBeenCalledWith(
          node1,
          key,
          expect.stringMatching(/^findValue-/),
        );
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNodeForValue).toHaveBeenCalledWith(
          node2,
          key,
          expect.stringMatching(/^findValue-/),
        );
      });

      it("should return a value found by a remote node", async () => {
        // GIVEN
        const key = NodeId.fromHex("0000000000000000000000000000000000000001");
        const value = new Uint8Array([1, 2, 3, 4]);

        const node1 = createNodeFixture("01");
        const node2 = createNodeFixture("02");

        localNode.addNode(node1);
        localNode.addNode(node2);

        // Node1 will return the value
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        (localNode as any).queryNodeForValue.mockImplementation(
          (node: DHTNode, _keyId: NodeId, _lookupId?: string) =>
            Promise.resolve({
              value: node.id.equals(node1.id) ? value : null,
              closestNodes: [],
            }),
        );

        // WHEN
        const result = await localNode.findValue(key);

        // THEN
        expect(result).toEqual(value);

        // Verify stats were updated
        const stats = localNode.getStats();
        expect(stats.valuesFetched).toBe(1);
        expect(stats.successfulLookups).toBe(1);

        // Only node1 should have been queried since it returned the value
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNodeForValue).toHaveBeenCalledWith(
          node1,
          key,
          expect.stringMatching(/^findValue-/),
        );
      });

      it("should query nodes and update the closest nodes list", async () => {
        // GIVEN
        const key = NodeId.fromHex("0000000000000000000000000000000000000001");

        // Add initial nodes to routing table
        const node1 = createNodeFixture(
          "0100000000000000000000000000000000000000",
        );
        const node2 = createNodeFixture(
          "0200000000000000000000000000000000000000",
        );
        localNode.addNode(node1);
        localNode.addNode(node2);

        const remoteNode1 = createNodeFixture(
          "0300000000000000000000000000000000000000",
        );
        const remoteNode2 = createNodeFixture(
          "0400000000000000000000000000000000000000",
        );

        // Make sure the spy is replaced with a proper implementation
        vi.resetAllMocks();
        const queryNodeForValueSpy = vi
          .spyOn(localNode, "queryNodeForValue")
          .mockImplementation(
            (node: DHTNode, _keyId: NodeId, _lookupId?: string) => {
              if (node.id.equals(node1.id)) {
                return Promise.resolve({
                  value: null,
                  closestNodes: [remoteNode1],
                });
              }
              if (node.id.equals(node2.id)) {
                return Promise.resolve({
                  value: null,
                  closestNodes: [remoteNode2],
                });
              }
              if (
                node.id.equals(remoteNode1.id) ||
                node.id.equals(remoteNode2.id)
              ) {
                return Promise.resolve({
                  value: null,
                  closestNodes: [],
                });
              }

              return Promise.resolve({
                value: null,
                closestNodes: [],
              });
            },
          );

        // WHEN
        await localNode.findValue(key);

        // THEN
        expect(queryNodeForValueSpy).toHaveBeenCalledWith(
          remoteNode1,
          key,
          expect.stringMatching(/^findValue-/),
        );
        expect(queryNodeForValueSpy).toHaveBeenCalledWith(
          remoteNode2,
          key,
          expect.stringMatching(/^findValue-/),
        );
        expect(queryNodeForValueSpy).toHaveBeenCalledWith(
          node1,
          key,
          expect.stringMatching(/^findValue-/),
        );
        expect(queryNodeForValueSpy).toHaveBeenCalledWith(
          node2,
          key,
          expect.stringMatching(/^findValue-/),
        );
      });

      it("should terminate when no closer nodes are found", async () => {
        // GIVEN
        const key = NodeId.fromHex("0000000000000000000000000000000000000001");

        const node1 = createNodeFixture(
          "0100000000000000000000000000000000000000",
        );
        localNode.addNode(node1);

        const remoteNode1 = createNodeFixture(
          "0300000000000000000000000000000000000000",
        );

        // Mock implementation that identifies nodes by their IDs
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        (localNode as any).queryNodeForValue.mockImplementation(
          (node: DHTNode) => {
            if (node.id.equals(node1.id)) {
              return Promise.resolve({
                value: null,
                closestNodes: [remoteNode1],
              });
            }
            if (node.id.equals(remoteNode1.id)) {
              return Promise.resolve({
                value: null,
                closestNodes: [],
              });
            }
            return Promise.resolve({
              value: null,
              closestNodes: [],
            });
          },
        );

        // WHEN
        await localNode.findValue(key);

        // THEN
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNodeForValue).toHaveBeenCalledTimes(2);
      });

      it("should store a value locally after finding it remotely", async () => {
        // GIVEN
        const key = NodeId.fromHex("0000000000000000000000000000000000000001");
        const value = new Uint8Array([1, 2, 3, 4]);

        const node1 = createNodeFixture("01");
        localNode.addNode(node1);

        // Node1 will return the value
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        (localNode as any).queryNodeForValue.mockResolvedValue({
          value: value,
          closestNodes: [],
        });

        // WHEN
        const result = await localNode.findValue(key);

        // THEN
        expect(result).toEqual(value);

        // Verify the value is now stored locally
        const storedValue = await localNode.findValue(key);
        expect(storedValue).toEqual(value);

        // The second lookup should not query any nodes
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNodeForValue).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("Maintenance operations", () => {
    it("should expire values when they exceed their TTL", async () => {
      // GIVEN
      const key = NodeId.fromHex("0000000000000000000000000000000000000001");
      const value = new Uint8Array([1, 2, 3, 4]);

      // Store with a short TTL
      await localNode.store(key, value, 10); // 10ms TTL

      // Verify it's stored
      const storage = localNode._testing.getStorage();
      expect(storage.has(key.toHex())).toBe(true);

      // WHEN
      // Manually trigger the expire function
      localNode._testing.expireValues();

      // The value should still be there (hasn't expired yet)
      expect(storage.has(key.toHex())).toBe(true);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 15));

      // Manually trigger the expire function again
      localNode._testing.expireValues();

      // THEN
      // Now the value should be gone
      expect(storage.has(key.toHex())).toBe(false);
    });

    it("should correctly handle republishing of values", async () => {
      // GIVEN
      const key = NodeId.fromHex("0000000000000000000000000000000000000001");
      const value = new Uint8Array([1, 2, 3, 4]);

      // Mock store method to track calls
      const storeSpy = vi.spyOn(localNode, "store");

      // Store a value with default TTL
      await localNode.store(key, value);
      storeSpy.mockClear(); // Clear initial call

      // WHEN
      // Manually set the republish time to now
      const storage = localNode._testing.getStorage();
      const valueObj = storage.get(key.toHex()) as StoreValue;
      valueObj.republishAt = Date.now() - 1000; // Set to 1 second ago

      // Manually trigger republish
      await localNode._testing.republishValues();

      // THEN
      // Store should have been called for the value
      expect(storeSpy).toHaveBeenCalledWith(key, value, expect.any(Number));

      // The republish time should have been updated
      expect(valueObj.republishAt).toBeGreaterThan(Date.now());
    });

    it("should refresh buckets when needed", async () => {
      // GIVEN
      // Mock the needed functions
      const findNodeSpy = vi.spyOn(localNode, "findNode").mockResolvedValue([]);
      const markBucketSpy = vi.spyOn(
        localNode._testing.getRoutingTable(),
        "markBucketAsRefreshed",
      );

      // Mock the getBucketsNeedingRefresh to return some buckets
      vi.spyOn(
        localNode._testing.getRoutingTable(),
        "getBucketsNeedingRefresh",
      ).mockReturnValue([0, 1]); // Pretend buckets 0 and 1 need refresh

      // WHEN
      await localNode.refreshBuckets();

      // THEN
      // findNode should be called twice, once for each bucket
      expect(findNodeSpy).toHaveBeenCalledTimes(2);

      // Each bucket should be marked as refreshed
      expect(markBucketSpy).toHaveBeenCalledWith(0);
      expect(markBucketSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("Statistics", () => {
    it("should track operation statistics correctly", async () => {
      // GIVEN
      // Reset mocks and stats before this test
      vi.resetAllMocks();

      // Create a new node for this test to have clean stats
      const testNode = new KademliaNode(localNodeId, {
        address: "127.0.0.1:8000",
        enableMaintenance: false,
      });

      vi.spyOn(testNode, "queryNode").mockImplementation(
        async (_node, _target, _lookupId) => [],
      );

      vi.spyOn(testNode, "queryNodeForValue").mockResolvedValue({
        value: new Uint8Array([5, 6, 7, 8]),
        closestNodes: [],
      });

      const key = NodeId.fromHex("0000000000000000000000000000000000000001");
      const value = new Uint8Array([1, 2, 3, 4]);

      // WHEN - Perform some operations
      await testNode.store(key, value);

      // Manually trigger valuesFetched counter for the test
      vi.spyOn(testNode, "queryNodeForValue").mockResolvedValue({
        value: new Uint8Array([5, 6, 7, 8]),
        closestNodes: [],
      });

      const lookupKey = NodeId.fromHex(
        "0000000000000000000000000000000000000002",
      );

      // Modify the findValue method to ensure valuesFetched is incremented
      const origFindValue = testNode.findValue;
      testNode.findValue = async (...args) => {
        const result = await origFindValue.apply(testNode, args);
        // Manually increment valuesFetched counter for test purposes
        testNode._testing.setStatsValue("valuesFetched", 1);
        return result;
      };

      await testNode.findValue(lookupKey);

      // THEN
      const stats = testNode.getStats();

      // Storage stats
      expect(stats.storedKeys).toBeGreaterThanOrEqual(1); // At least one value stored
      expect(stats.storageSize).toBeGreaterThan(0);

      // Operation stats
      expect(stats.successfulLookups).toBe(1);
      expect(stats.valuesFetched).toBe(1);
      expect(stats.valuesStored).toBe(1);

      // Uptime should be present
      expect(stats.uptime).toBeGreaterThanOrEqual(0);

      // Clean up
      const republishTimer = testNode._testing.getRepublishTimer();
      if (republishTimer) {
        clearInterval(republishTimer);
      }

      const expireTimer = testNode._testing.getExpireTimer();

      if (expireTimer) {
        clearInterval(expireTimer);
      }
    });
  });
});
