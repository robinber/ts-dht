import type { NodeId } from "../core";
import type { DHTNode } from "./k-bucket";

export interface NodeLocator {
  /**
   * Find the closest nodes to a target ID
   * @param targetId The target NodeId to find nodes close to
   * @param count Maximum number of nodes to return
   */
  findClosestNodes(targetId: NodeId, count?: number): DHTNode[];

  /**
   * Find nodes within a specific distance from a target ID
   * @param targetId The target NodeId
   * @param maxDistance Maximum scalar distance from target
   */
  findNodesWithinDistance(targetId: NodeId, maxDistance: bigint): DHTNode[];

  /**
   * Find a specific node by its ID
   * @param nodeId The NodeId to find
   */
  findNode(nodeId: NodeId): DHTNode | undefined;

  /**
   * Get all nodes
   */
  getAllNodes(): DHTNode[];

  /**
   * Get the number of nodes
   */
  size(): number;
}
