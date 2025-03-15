import type { DHTNode } from "../k-bucket";
import { NodeId } from "../node-id";

export function createNodeFixture(hex: string): DHTNode {
  return {
    id: NodeId.fromHex(hex.padStart(NodeId.SIZE_IN_BYTES * 2, "0")),
    address: "127.0.0.1:8080",
  };
}
