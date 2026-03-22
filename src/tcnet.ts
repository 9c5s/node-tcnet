import { Socket, createSocket, RemoteInfo } from "dgram";
import EventEmitter = require("events");
import * as nw from "./network";
import { MultiPacketAssembler } from "./multi-packet";
import { interfaceAddress } from "./utils";

const TCNET_BROADCAST_PORT = 60000;
const TCNET_TIMESTAMP_PORT = 60001;

type STORED_REQUEST = {
    resolve: (value?: nw.TCNetDataPacket | PromiseLike<nw.TCNetDataPacket> | undefined) => void;
    reject: (reason?: unknown) => void;
    timeout: NodeJS.Timeout;
    assembler?: MultiPacketAssembler;
};

const MULTI_PACKET_TYPES = new Set([nw.TCNetDataPacketType.BigWaveFormData, nw.TCNetDataPacketType.BeatGridData]);

export type TCNetLogger = {
    error: (error: Error) => void;
    debug: (message: string) => void;
};

export class TCNetConfiguration {
    logger: TCNetLogger | null = null;
    unicastPort = 65023;
    applicationCode = 0xffff;
    nodeId = Math.floor(Math.random() * 0xffff);
    nodeName = "TCNET.JS";
    vendorName = "CHDXD1";
    appName = "NODE-TCNET";
    broadcastInterface: string | null = null;
    broadcastAddress = "255.255.255.255";
    broadcastListeningAddress = "";
    requestTimeout = 2000;
}

const closeSocket = (socket: Socket): Promise<void> => new Promise((resolve) => socket.close(() => resolve()));

/**
 * Low level implementation of the TCNet protocol
 */
export class TCNetClient extends EventEmitter {
    private config: TCNetConfiguration;
    private broadcastSocket: Socket;
    private unicastSocket: Socket;
    private timestampSocket: Socket;
    private server: RemoteInfo | null;
    private seq = 0;
    private uptime = 0;
    private connected = false;
    private connectedHandler: (() => void) | null = null;
    private requests: Map<string, STORED_REQUEST> = new Map();
    private announcementInterval: NodeJS.Timeout;

    /**
     *
     * @param config configuration for TCNet access
     */
    constructor(config?: TCNetConfiguration) {
        super();
        this.config = config || new TCNetConfiguration();

        if (this.config.broadcastInterface && this.config.broadcastAddress == "255.255.255.255") {
            this.config.broadcastAddress = interfaceAddress(this.config.broadcastInterface);
        }
        this.config.broadcastListeningAddress ||= "0.0.0.0";
    }

    public get log(): TCNetLogger | null {
        return this.config.logger;
    }

    /**
     * Wrapper method to bind a socket with a Promise
     * @param socket socket to bind
     * @param port port to bind to
     * @param address address to bind to
     * @returns Promise which always resolves (no errors in callback)
     */
    private bindSocket(socket: Socket, port: number, address: string): Promise<void> {
        return new Promise((resolve, reject) => {
            socket.once("error", reject);

            socket.bind(port, address, () => {
                socket.removeListener("error", reject);
                resolve();
            });
        });
    }

    /**
     * Connect to the TCNet networks
     */
    public async connect(): Promise<void> {
        this.broadcastSocket = createSocket({ type: "udp4", reuseAddr: true }, this.receiveBroadcast.bind(this));
        await this.bindSocket(this.broadcastSocket, TCNET_BROADCAST_PORT, this.config.broadcastListeningAddress);
        this.broadcastSocket.setBroadcast(true);

        this.timestampSocket = createSocket({ type: "udp4", reuseAddr: true }, this.receiveTimestamp.bind(this));
        await this.bindSocket(this.timestampSocket, TCNET_TIMESTAMP_PORT, this.config.broadcastListeningAddress);
        this.timestampSocket.setBroadcast(true);

        this.unicastSocket = createSocket({ type: "udp4", reuseAddr: false }, this.receiveUnicast.bind(this));
        await this.bindSocket(this.unicastSocket, this.config.unicastPort, "0.0.0.0");

        await this.announceApp();
        this.announcementInterval = setInterval(this.announceApp.bind(this), 1000);

        await this.waitConnected();
    }

    /**
     * Disconnects from TCNet network
     */
    public disconnect(): Promise<void> {
        clearInterval(this.announcementInterval);
        this.removeAllListeners();
        this.connected = false;
        return Promise.all([
            closeSocket(this.broadcastSocket),
            closeSocket(this.unicastSocket),
            closeSocket(this.timestampSocket),
        ])
            .catch((err) => {
                const error = new Error("Error disconnecting from TCNet");
                error.cause = err instanceof Error ? err : new Error(String(err));
                this.log?.error(error);
            })
            .then(() => void 0);
    }

    /**
     * Waiting for unicast from a master
     */
    private waitConnected(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.connectedHandler = resolve;

            setTimeout(() => {
                if (!this.connected) {
                    this.disconnect();
                    reject(new Error("Timeout connecting to network"));
                }
            }, this.config.requestTimeout);
        });
    }

    /**
     * Parse a packet from a ManagementHeader
     * @param header the received management header
     * @returns the parsed packet
     */
    private parsePacket(header: nw.TCNetManagementHeader): nw.TCNetPacket | null {
        const packetClass = nw.TCNetPackets[header.messageType];
        if (packetClass !== null) {
            const packet = new packetClass();
            // Set buffer & header before reading length,
            // as variable-length messages don't have a well-known fixed size,
            // and may need to read from buffer to determine the length
            packet.buffer = header.buffer;
            packet.header = header;

            if (packet.length() !== -1 && packet.length() !== header.buffer.length) {
                this.log?.debug(
                    `${
                        nw.TCNetMessageType[header.messageType]
                    } packet has the wrong length (expected: ${packet.length()}, received: ${header.buffer.length})`,
                );
                return null;
            }
            packet.read();

            return packet;
        } else {
            this.log?.debug(`Unknown packet type: ${header.messageType} ${nw.TCNetMessageType[header.messageType]}`);
        }
        return null;
    }

    /**
     * Callback method to receive datagrams on the broadcast socket
     *
     * @param msg datagram buffer
     * @param rinfo remoteinfo
     */
    private receiveBroadcast(msg: Buffer, rinfo: RemoteInfo): void {
        const mgmtHeader = new nw.TCNetManagementHeader(msg);
        mgmtHeader.read();
        const packet: nw.TCNetPacket | null = this.parsePacket(mgmtHeader);

        if (packet) {
            if (packet instanceof nw.TCNetOptInPacket) {
                if (mgmtHeader.nodeType == nw.NodeType.Master) {
                    // MasterのブロードキャストOptInからも接続を検出する
                    // (同一マシン上のBridgeはユニキャスト応答を返さない場合がある)
                    this.server = rinfo;
                    this.server.port = packet.nodeListenerPort;
                    if (this.connectedHandler) {
                        this.connected = true;
                        // 即座にOptInを送信してMasterに登録する
                        this.announceApp().catch((err) => {
                            const error = err instanceof Error ? err : new Error(String(err));
                            this.log?.debug(`Failed to announce on connect: ${error.message}`);
                        });
                        this.connectedHandler();
                        this.connectedHandler = null;
                    }
                }
            }

            if (packet instanceof nw.TCNetOptOutPacket) {
                if (mgmtHeader.nodeType == nw.NodeType.Master) {
                    // We received an OptOut packet from a server
                    this.log?.debug("Received optout from current Master");
                    if (this.server?.address == rinfo.address && this.server?.port == packet.nodeListenerPort) {
                        this.server = null;
                    }
                }
            }

            if (this.connected) {
                this.emit("broadcast", packet);
            }
        } else {
            this.log?.debug(`Unknown broadcast packet type: ${mgmtHeader.messageType}`);
        }
    }

    /**
     * Callback method to receive datagrams on the unicast socket
     *
     * @param msg datagram buffer
     * @param rinfo remoteinfo
     */
    private receiveUnicast(msg: Buffer, rinfo: RemoteInfo): void {
        const mgmtHeader = new nw.TCNetManagementHeader(msg);
        mgmtHeader.read();
        const packet = this.parsePacket(mgmtHeader);

        if (packet instanceof nw.TCNetDataPacket) {
            const dataPacketClass = nw.TCNetDataPackets[packet.dataType];
            if (dataPacketClass !== null) {
                const dataPacket: nw.TCNetDataPacket = new dataPacketClass();
                dataPacket.buffer = msg;
                dataPacket.header = mgmtHeader;
                dataPacket.dataType = packet.dataType;
                dataPacket.layer = packet.layer;
                dataPacket.read();

                const key = `${dataPacket.dataType}-${dataPacket.layer}`;
                const pendingRequest = this.requests.get(key);

                if (pendingRequest && pendingRequest.assembler) {
                    // マルチパケット: アセンブラに蓄積
                    const complete = pendingRequest.assembler.add(msg);

                    if (this.connected) {
                        this.emit("data", dataPacket);
                    }

                    if (complete) {
                        const assembled = pendingRequest.assembler.assemble();
                        const finalPacket = new dataPacketClass();
                        finalPacket.buffer = msg;
                        finalPacket.header = mgmtHeader;
                        finalPacket.dataType = dataPacket.dataType;
                        finalPacket.layer = dataPacket.layer;
                        if ("readAssembled" in finalPacket && typeof finalPacket.readAssembled === "function") {
                            finalPacket.readAssembled(assembled);
                        }
                        this.requests.delete(key);
                        clearTimeout(pendingRequest.timeout);
                        pendingRequest.resolve(finalPacket);
                    } else {
                        // パケット到着ごとにタイムアウトをリセット
                        clearTimeout(pendingRequest.timeout);
                        pendingRequest.timeout = setTimeout(() => {
                            if (this.requests.delete(key)) {
                                pendingRequest.reject(new Error("Timeout while requesting data"));
                            }
                        }, this.config.requestTimeout);
                    }
                } else {
                    // 単一パケット: 従来通り
                    if (this.connected) {
                        this.emit("data", dataPacket);
                    }
                    if (pendingRequest) {
                        this.requests.delete(key);
                        clearTimeout(pendingRequest.timeout);
                        pendingRequest.resolve(dataPacket);
                    }
                }
            }
        } else if (packet instanceof nw.TCNetOptInPacket) {
            // Received OptIn directly via Unicast --> we are registered at the destination now.
            if (mgmtHeader.nodeType == nw.NodeType.Master) {
                // Received OptIn from Master --> registered at Pro DJ Link Bridge or comparable tool
                this.server = rinfo;
                this.server.port = packet.nodeListenerPort;
                if (this.connectedHandler) {
                    this.connected = true;

                    this.connectedHandler();
                    this.connectedHandler = null;
                }
            }
        } else {
            if (this.connected) {
                this.emit("broadcast", packet);
            }
        }
    }

    /**
     * Callback method to receive datagrams on the timestamp socket
     * @param msg datagram buffer
     * @param rinfo remoteinfo
     */
    private receiveTimestamp(msg: Buffer, _rinfo: RemoteInfo): void {
        const mgmtHeader = new nw.TCNetManagementHeader(msg);
        mgmtHeader.read();
        if (mgmtHeader.messageType !== nw.TCNetMessageType.Time) {
            this.log?.debug("Received non Time packet on Time port");
            return;
        }

        const packet = this.parsePacket(mgmtHeader);
        this.emit("time", packet);
    }

    /**
     * Fill headers of a packet
     *
     * @param packet Packet that needs header information
     */
    private fillHeader(packet: nw.TCNetPacket): void {
        packet.header = new nw.TCNetManagementHeader(packet.buffer);

        packet.header.minorVersion = 5;
        packet.header.nodeId = this.config.nodeId;
        packet.header.messageType = packet.type();
        packet.header.nodeName = this.config.nodeName;
        packet.header.seq = this.seq = (this.seq + 1) % 255;
        packet.header.nodeType = 0x04;
        packet.header.nodeOptions = 0;
        packet.header.timestamp = 0;
    }

    /**
     * Generalized method to send packets to a given destination on a given socket
     *
     * @param packet Packet to send
     * @param socket Socket to send on
     * @param port Destination Port
     * @param address Destination Address
     */
    private sendPacket(packet: nw.TCNetPacket, socket: Socket, port: number, address: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const buffer = Buffer.alloc(packet.length());
            packet.buffer = buffer;
            this.fillHeader(packet);

            packet.header.write();
            packet.write();
            socket.send(buffer, port, address, (err) => {
                if (err) reject(err);
                resolve();
            });
        });
    }

    /**
     * Sends a packet to the discovered server
     * @param packet Packet to send
     */
    public async sendServer(packet: nw.TCNetPacket): Promise<void> {
        if (this.server === null) {
            throw new Error("Server not yet discovered");
        }

        await this.sendPacket(packet, this.broadcastSocket, this.server.port, this.server.address);
    }

    /**
     * Called every second to announce our app on the network
     */
    private async announceApp(): Promise<void> {
        const optInPacket = new nw.TCNetOptInPacket();
        optInPacket.nodeCount = 0;
        optInPacket.nodeListenerPort = this.config.unicastPort;
        optInPacket.uptime = this.uptime++;

        // According to the guide the uptime shall roll over after 12 hours
        if (this.uptime >= 12 * 60 * 60) {
            this.uptime = 0;
        }

        optInPacket.vendorName = this.config.vendorName;
        optInPacket.appName = this.config.appName;
        optInPacket.majorVersion = 1;
        optInPacket.minorVersion = 1;
        optInPacket.bugVersion = 1;
        await this.broadcastPacket(optInPacket);
        if (this.server) {
            await this.sendServer(optInPacket);
        }
    }

    /**
     * Broadcasts a packet to the network
     *
     * @param packet packet to broadcast
     */
    public async broadcastPacket(packet: nw.TCNetPacket): Promise<void> {
        await this.sendPacket(packet, this.broadcastSocket, TCNET_BROADCAST_PORT, this.config.broadcastAddress);
    }

    /**
     * Sends a request packet to the discovered server
     *
     * @param dataType requested data type
     * @param layer requested layer
     * @returns Promise to wait for answer on request
     */
    public requestData(dataType: number, layer: number): Promise<nw.TCNetDataPacket> {
        return new Promise((resolve, reject) => {
            if (!Number.isInteger(layer) || layer < 0 || layer > 7) {
                reject(new RangeError("layer must be an integer between 0 and 7"));
                return;
            }

            const request = new nw.TCNetRequestPacket();
            request.dataType = dataType;
            request.layer = layer + 1; // APIは0-based、仕様は1-based

            const key = `${dataType}-${layer}`;
            const timeout = setTimeout(() => {
                if (this.requests.delete(key)) {
                    reject(new Error("Timeout while requesting data"));
                }
            }, this.config.requestTimeout);

            this.requests.set(key, {
                resolve,
                reject,
                timeout,
                assembler: MULTI_PACKET_TYPES.has(dataType) ? new MultiPacketAssembler() : undefined,
            });

            this.sendServer(request).catch((err) => {
                if (this.requests.delete(key)) {
                    clearTimeout(timeout);
                    reject(err);
                }
            });
        });
    }
}
