import { NodeId } from "../core";
import type { DHTNode } from "../routing";

export function createNodeFixture(hex: string): DHTNode {
  return {
    id: NodeId.fromHex(hex.padStart(NodeId.SIZE_IN_BYTES * 2, "0")),
    address: "127.0.0.1:8080",
  };
}
