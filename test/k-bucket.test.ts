import { describe, expect, it } from "vitest";
import { createNodeFixture } from "../src/__test__/createNode.fixture";
import { KBucket } from "../src/k-bucket";
import { NodeId } from "../src/node-id";

describe("KBucket", () => {
  describe("#addNode", () => {
    it("should add a node to an empty bucket", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId);
      const node = createNodeFixture("01");

      // WHEN
      const nodesToPing = bucket.addNode(node);

      // THEN
      expect(nodesToPing).toHaveLength(0);
      expect(bucket.size()).toEqual(1);
      expect(bucket.contains(node.id)).toEqual(true);
    });

    it("should not add the local node to its own bucket", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId);
      const node = createNodeFixture(nodeId.toHex());

      // WHEN
      const nodesToPing = bucket.addNode(node);

      // THEN
      expect(nodesToPing).toHaveLength(0);
      expect(bucket.size()).toEqual(0);
      expect(bucket.contains(node.id)).toEqual(false);
    });

    it("should update existing node instead of adding it", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId);
      const node = createNodeFixture("01");

      // WHEN
      bucket.addNode(node);
      const nodesToPing = bucket.addNode(node);

      // THEN
      expect(nodesToPing).toHaveLength(0);
      expect(bucket.size()).toEqual(1);
      expect(bucket.contains(node.id)).toEqual(true);
    });

    it("should return nodes to ping when the bucket is full", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId, { k: 2, pingCount: 1 });

      // Fill the bucket
      const node1 = createNodeFixture("01");
      const node2 = createNodeFixture("02");
      bucket.addNode(node1);
      bucket.addNode(node2);
      const node3 = createNodeFixture("03");

      // WHEN
      const nodesToPing = bucket.addNode(node3);

      // THEN
      expect(bucket.size()).toEqual(2);
      expect(nodesToPing).toHaveLength(1);
      expect(nodesToPing[0].id.equals(node1.id)).toBe(true);
    });
  });

  describe("#removeNode", () => {
    it("should remove a node from the bucket", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId);
      const node = createNodeFixture("01");
      bucket.addNode(node);

      // WHEN
      const removed = bucket.removeNode(node.id);

      // THEN
      expect(removed).toBe(true);
      expect(bucket.size()).toBe(0);
    });

    it("should not remove a node that does not exist in the bucket", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId);
      const node = createNodeFixture("01");

      // WHEN
      const removed = bucket.removeNode(node.id);

      // THEN
      expect(removed).toBe(false);
    });
  });

  describe("#findClosestNodes", () => {
    it("should find the closest nodes to a target node ID", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId);

      const targetId = NodeId.fromHex(
        "0000000000000000000000000000000000000000",
      );

      const node1 = createNodeFixture("01");
      const node2 = createNodeFixture("02");
      const node3 = createNodeFixture("03");

      bucket.addNode(node1);
      bucket.addNode(node2);
      bucket.addNode(node3);

      // WHEN
      const closestNodes = bucket.findClosestNodes(targetId, 2);

      // THEN
      expect(closestNodes).toHaveLength(2);
      expect(closestNodes[0].id.equals(node1.id)).toBe(true);
      expect(closestNodes[1].id.equals(node2.id)).toBe(true);
    });

    it("should return all nodes when count is greater than the bucket size", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId);

      const targetId = NodeId.fromHex(
        "0000000000000000000000000000000000000000",
      );

      const node1 = createNodeFixture("01");
      const node2 = createNodeFixture("02");

      bucket.addNode(node1);
      bucket.addNode(node2);

      // WHEN
      const closestNodes = bucket.findClosestNodes(targetId, 3);

      // THEN
      expect(closestNodes).toHaveLength(2);
    });
  });

  describe("#findNode", () => {
    it("should find a node in the bucket", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId);
      const node1 = createNodeFixture("01");

      bucket.addNode(node1);

      // WHEN
      const node = bucket.findNode(node1.id);

      // THEN
      expect(node).toBeDefined();
      expect(node?.id.equals(node1.id)).toBe(true);
    });

    it("should return undefined if node does not exist in the bucket", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId);

      // WHEN
      const node = bucket.findNode(NodeId.random());

      // THEN
      expect(node).toBeUndefined();
    });
  });

  describe("#updateNodeTimestamp", () => {
    it("should update the node timestamp", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId);

      const node = createNodeFixture("01");
      bucket.addNode(node);

      // WHEN
      bucket.updateNodeTimestamp(node.id);

      // THEN
      const updatedNode = bucket.findNode(node.id);

      expect(updatedNode).toBeDefined();
      expect(updatedNode?.lastSeen).toBeGreaterThan(0);
    });

    it("should not update the timestamp if the node does not exist", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId);

      // WHEN
      bucket.updateNodeTimestamp(NodeId.random());

      // THEN
      expect(bucket.size()).toBe(0);
    });
  });

  describe("#isFull", () => {
    it("should return true if the bucket is full", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId, { k: 2 });

      const node1 = createNodeFixture("01");
      const node2 = createNodeFixture("02");

      bucket.addNode(node1);
      bucket.addNode(node2);

      // WHEN
      const isFull = bucket.isFull();

      // THEN
      expect(isFull).toBe(true);
    });

    it("should return false if the bucket is not full", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId, { k: 2 });

      const node1 = createNodeFixture("01");
      bucket.addNode(node1);

      // WHEN
      const isFull = bucket.isFull();

      // THEN
      expect(isFull).toBe(false);
    });
  });

  describe("#getAllNodes", () => {
    it("should return all nodes in the bucket", () => {
      // GIVEN
      const nodeId = NodeId.random();
      const bucket = new KBucket(nodeId);

      const node1 = createNodeFixture("01");
      const node2 = createNodeFixture("02");

      bucket.addNode(node1);
      bucket.addNode(node2);

      // WHEN
      const nodes = bucket.getAllNodes();

      // THEN
      expect(nodes).toHaveLength(2);
    });
  });
});
