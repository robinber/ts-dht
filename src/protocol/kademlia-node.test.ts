import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeFixture } from "../__fixtures__/createNode.fixture";
import { NodeId } from "../core";
import type { DHTNode } from "../routing";
import { KademliaNode } from "./kademlia-node";

describe("KademliaNode", () => {
  let localNode: KademliaNode;
  let localNodeId: NodeId;

  beforeEach(() => {
    localNodeId = NodeId.fromHex("0000000000000000000000000000000000000000");
    localNode = new KademliaNode(localNodeId, { address: "127.0.0.1:8000" });

    vi.spyOn(localNode, "queryNode").mockImplementation(async () => []);
    vi.spyOn(localNode, "queryNodeForValue").mockImplementation(async () => ({
      value: null,
      closestNodes: [],
    }));
  });

  describe("findNode", () => {
    it("should return local nodes when no remote nodes responds", async () => {
      // GIVEN
      const target = NodeId.fromHex("0000000000000000000000000000000000000001");

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
      (localNode as any).queryNode.mockImplementation((node: DHTNode) =>
        Promise.resolve([node.id.equals(node1.id) ? remoteNode1 : remoteNode2]),
      );

      // Set target and call findNode
      const target = NodeId.fromHex("0000000000000000000000000000000000000001");

      // WHEN
      const result = await localNode.findNode(target);

      // THEN
      expect(result.length).toBeGreaterThanOrEqual(4);
      expect(result.some((node) => node.id.equals(node1.id))).toBe(true);
      expect(result.some((node) => node.id.equals(node2.id))).toBe(true);
      expect(result.some((node) => node.id.equals(remoteNode1.id))).toBe(true);
      expect(result.some((node) => node.id.equals(remoteNode2.id))).toBe(true);

      // biome-ignore lint/suspicious/noExplicitAny: this is a mock
      expect((localNode as any).queryNode).toHaveBeenCalledWith(node1, target);
      // biome-ignore lint/suspicious/noExplicitAny: this is a mock
      expect((localNode as any).queryNode).toHaveBeenCalledWith(node2, target);
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
      (localNode as any).queryNode
        .mockResolvedValueOnce([remoteNode1])
        .mockResolvedValue([]);

      const target = NodeId.fromHex("0000000000000000000000000000000000000001");

      // WHEN
      await localNode.findNode(target);

      // THEN
      // biome-ignore lint/suspicious/noExplicitAny: this is a mock
      expect((localNode as any).queryNode).toHaveBeenCalledTimes(2);
    });

    it("should sort nodes by distance to target", async () => {
      // GIVEN
      const target = NodeId.fromHex("0000000000000000000000000000000000000000");

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

  describe("#findValue", () => {
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
        );
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNodeForValue).toHaveBeenCalledWith(
          node2,
          key,
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
          (node: DHTNode) =>
            Promise.resolve({
              value: node.id.equals(node1.id) ? value : null,
              closestNodes: [],
            }),
        );

        // WHEN
        const result = await localNode.findValue(key);

        // THEN
        expect(result).toEqual(value);

        // Only node1 should have been queried since it returned the value
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNodeForValue).toHaveBeenCalledWith(
          node1,
          key,
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

        // First round: node1 returns remoteNode1, node2 returns remoteNode2
        // Second round: new nodes don't return anything
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        (localNode as any).queryNodeForValue.mockImplementation(
          (node: DHTNode) => {
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
        expect((localNode as any).queryNodeForValue).toHaveBeenCalledWith(
          node1,
          key,
        );
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNodeForValue).toHaveBeenCalledWith(
          node2,
          key,
        );
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNodeForValue).toHaveBeenCalledWith(
          remoteNode1,
          key,
        );
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        expect((localNode as any).queryNodeForValue).toHaveBeenCalledWith(
          remoteNode2,
          key,
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

        // First query returns a new node, second returns nothing
        // biome-ignore lint/suspicious/noExplicitAny: this is a mock
        (localNode as any).queryNodeForValue
          .mockResolvedValueOnce({
            value: null,
            closestNodes: [remoteNode1],
          })
          .mockResolvedValue({
            value: null,
            closestNodes: [],
          });

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
});
