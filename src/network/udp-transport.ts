import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import { z } from "zod";

const MAX_UDP_PACKET_SIZE = 65507; // Maximum UDP packet size

export interface UDPTransportOptions {
  bindAddress: UDPAddress;
  socketType?: dgram.SocketType;
  maxPacketSize?: number;
}

export interface MessageEvent {
  data: Buffer;
  rInfo: dgram.RemoteInfo;
}

const UDPAddressSchema = z.object({
  address: z.string(),
  port: z.number().int().positive(),
});

type UDPAddress = z.infer<typeof UDPAddressSchema>;

export class UDPTransport extends EventEmitter {
  private socket: dgram.Socket;
  private readonly maxPacketSize: number;
  private readonly bindAddress: UDPAddress;
  private isRunning = false;

  constructor(options: UDPTransportOptions) {
    super();

    this.bindAddress = UDPAddressSchema.parse(options.bindAddress);
    this.maxPacketSize = options.maxPacketSize || MAX_UDP_PACKET_SIZE;

    this.socket = dgram.createSocket({
      type: options.socketType || "udp4",
      reuseAddr: true,
    });

    this.socket.on("error", (err) => this.handleError(err));
    this.socket.on("message", (msg, rInfo) => this.handleMessage(msg, rInfo));
    this.socket.on("listening", () => this.handleListening());
    this.socket.on("close", () => this.handleClose());
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    return new Promise((resolve, reject) => {
      const onError = (err: Error) => {
        this.socket.removeListener("listening", onListening);
        reject(err);
      };

      const onListening = () => {
        this.socket.removeListener("error", onError);
        this.isRunning = true;
        resolve();
      };

      this.socket.once("error", onError);
      this.socket.once("listening", onListening);

      try {
        this.socket.bind({
          address: this.bindAddress.address,
          port: this.bindAddress.port,
        });
      } catch (err) {
        this.socket.removeListener("error", onError);
        this.socket.removeListener("listening", onListening);
        reject(err);
      }
    });
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    return new Promise((resolve) => {
      this.socket.close(() => {
        this.isRunning = false;
        resolve();
      });
    });
  }

  public getBindAddress(): UDPAddress {
    return this.bindAddress;
  }

  public send(message: Buffer, address: UDPAddress): Promise<void> {
    if (!this.isRunning) {
      throw new Error("Socket is not running");
    }

    if (message.length > this.maxPacketSize) {
      throw new Error("Message exceeds maximum packet size");
    }

    return new Promise((resolve, reject) => {
      this.socket.send(message, address.port, address.address, (err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }

  private handleError(err: Error) {
    this.emit("error", err);
  }

  private handleMessage(msg: Buffer, rInfo: dgram.RemoteInfo) {
    this.emit("message", { data: msg, rInfo } as MessageEvent);
  }

  private handleListening() {
    const address = this.socket.address();
    this.emit("listening", address);
  }

  private handleClose() {
    this.emit("close");
  }
}
