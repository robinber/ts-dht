import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MessageEvent, UDPTransport } from "./udp-transport";

describe("UDPTransport", () => {
  let transport1: UDPTransport;
  let transport2: UDPTransport;

  beforeEach(async () => {
    // Create two UDP transports with different ports
    transport1 = new UDPTransport({
      bindAddress: {
        address: "0.0.0.0",
        port: 50001,
      },
    });

    transport2 = new UDPTransport({
      bindAddress: {
        address: "0.0.0.0",
        port: 50002,
      },
    });

    // Start both transports
    await transport1.start();
    await transport2.start();
  });

  afterEach(async () => {
    // Stop both transports
    await transport1.stop();
    await transport2.stop();
  });

  it("should successfully send and receive messages", async () => {
    // Create a message to send
    const testMessage = Buffer.from("Hello from transport1");

    // Set up a promise that will resolve when transport2 receives the message
    const messagePromise = new Promise<MessageEvent>((resolve) => {
      transport2.once("message", (messageEvent) => {
        resolve(messageEvent);
      });
    });

    // Get the bind address for transport2
    const transport2Address = transport2.getBindAddress();

    // Send the message from transport1 to transport2
    await transport1.send(testMessage, transport2Address);

    // Wait for the message to be received
    const receivedEvent = await messagePromise;

    // Verify the received message
    expect(receivedEvent.data.toString()).toBe(testMessage.toString());
    expect(receivedEvent.rInfo.address).toBeTruthy();
    expect(receivedEvent.rInfo.port).toBe(50001); // Should be from transport1
  });

  it("should handle errors when sending to an invalid address", async () => {
    // Attempt to send to an invalid address
    const invalidAddress = {
      address: "invalid-address",
      port: 9999,
    };

    // This should throw an error
    await expect(
      transport1.send(Buffer.from("Test message"), invalidAddress),
    ).rejects.toThrow();
  });

  it("should emit events when starting and stopping", async () => {
    // Create a new transport for this test
    const transport = new UDPTransport({
      bindAddress: {
        address: "0.0.0.0",
        port: 50003,
      },
    });

    // Set up event listeners
    const listeningPromise = new Promise<void>((resolve) => {
      transport.once("listening", () => resolve());
    });

    const closePromise = new Promise<void>((resolve) => {
      transport.once("close", () => resolve());
    });

    // Start the transport
    await transport.start();

    // Verify listening event was emitted
    await listeningPromise;

    // Stop the transport
    await transport.stop();

    // Verify close event was emitted
    await closePromise;
  });
});
