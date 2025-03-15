import { NodeId } from "../core/node-id";
import type { DHTNode } from "../routing/k-bucket";

export function createNodeFixture(hex: string): DHTNode {
  return {
    id: NodeId.fromHex(hex.padStart(NodeId.SIZE_IN_BYTES * 2, "0")),
    address: "127.0.0.1:8080",
  };
}
