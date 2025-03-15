import { describe, expect, it } from "vitest";
import { createNodeFixture } from "../__fixtures__/createNode.fixture";

import { NodeId } from "../core/node-id";
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
