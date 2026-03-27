import { Socket, createSocket, RemoteInfo } from "dgram";
import { EventEmitter } from "events";
import * as nw from "./network";
import { MultiPacketAssembler } from "./multi-packet";
import { interfaceAddress, listNetworkAdapters, findIPv4Address, type NetworkAdapterInfo } from "./utils";
import { generateAuthPayload, type AuthState } from "./auth";

const TCNET_BROADCAST_PORT = 60000;
const TCNET_TIMESTAMP_PORT = 60001;
const AUTH_RESPONSE_TIMEOUT = 5000;

type STORED_REQUEST = {
    resolve: (value: nw.TCNetDataPacket | PromiseLike<nw.TCNetDataPacket>) => void;
    reject: (reason?: unknown) => void;
    timeout: NodeJS.Timeout;
    assembler?: MultiPacketAssembler;
};

const MULTI_PACKET_TYPES: Set<number> = new Set([
    nw.TCNetDataPacketType.BigWaveFormData,
    nw.TCNetDataPacketType.BeatGridData,
    nw.TCNetDataPacketType.ArtworkData,
]);

/**
 * TCNetClientが使用するロガーインタフェース
 * @category Client
 */
export type TCNetLogger = {
    error: (error: Error) => void;
    debug: (message: string) => void;
};

/**
 * TCNetClientの設定
 * @category Client
 */
export class TCNetConfiguration {
    logger: TCNetLogger | null = null;
    unicastPort = 65023;
    applicationCode = 0xffff;
    nodeId = Math.floor(Math.random() * 0xffff);
    nodeName = "TCNet.js";
    vendorName = "9c5s";
    appName = "node-tcnet";
    broadcastInterface: string | null = null;
    broadcastAddress = "255.255.255.255";
    broadcastListeningAddress = "";
    requestTimeout = 2000;
    detectionTimeout = 5000;
    switchRetryCount = 3;
    switchRetryInterval = 1000;
    /** XTEA暗号文 (16桁hex文字列)。設定時はTCNASDP認証を実行する。環境変数 TCNET_XTEA_CIPHERTEXT で上書き可能 */
    xteaCiphertext?: string = process.env.TCNET_XTEA_CIPHERTEXT;
}

/**
 * ソケットをクローズしてPromiseで返す
 * @param socket - クローズするソケット
 * @returns クローズ完了のPromise
 */
function closeSocket(socket: Socket): Promise<void> {
    return new Promise((resolve) => socket.close(() => resolve()));
}

/**
 * TCNetプロトコルの低レベル実装
 * @category Client
 */
export class TCNetClient extends EventEmitter {
    private config: TCNetConfiguration;
    private broadcastSocket: Socket | null = null;
    private unicastSocket: Socket | null = null;
    private timestampSocket: Socket | null = null;
    private server: RemoteInfo | null = null;
    private seq = 0;
    private uptime = 0;
    private connected = false;
    private connectedHandler: (() => void) | null = null;
    private connectedReject: ((reason?: unknown) => void) | null = null;
    private requests: Map<string, STORED_REQUEST> = new Map();
    private announcementInterval: NodeJS.Timeout | null = null;
    private broadcastSockets: Map<string, Socket> = new Map();
    private timestampSockets: Map<string, Socket> = new Map();
    private adapterMap: Map<string, NetworkAdapterInfo> = new Map();
    private _selectedAdapter: NetworkAdapterInfo | null = null;
    private switching = false;
    private connectTimeoutId: NodeJS.Timeout | null = null;
    private detectionTimeoutId: NodeJS.Timeout | null = null;
    private detectingAdapter = false;
    private _authState: AuthState = "none";
    private sessionToken: number | null = null;
    private authTimeoutId: NodeJS.Timeout | null = null;

    /**
     * TCNetClientを初期化する
     * @param config - TCNetアクセスの設定。省略時はデフォルト値を使用
     */
    constructor(config?: TCNetConfiguration) {
        super();
        this.config = config || new TCNetConfiguration();

        if (this.config.broadcastInterface && this.config.broadcastAddress == "255.255.255.255") {
            this.config.broadcastAddress = interfaceAddress(this.config.broadcastInterface);
        }
        this.config.broadcastListeningAddress ||= "0.0.0.0";
    }

    /**
     * ロガーを返す
     * @returns ロガー。未設定の場合はnull
     */
    public get log(): TCNetLogger | null {
        return this.config.logger;
    }

    /**
     * 選択されたネットワークアダプタを返す
     * @returns アダプタ情報。未選択の場合はnull
     */
    public get selectedAdapter(): NetworkAdapterInfo | null {
        return this._selectedAdapter;
    }

    /**
     * 接続状態を返す
     * @returns 接続中の場合はtrue
     */
    public get isConnected(): boolean {
        return this.connected;
    }

    /**
     * TCNASDP認証状態を返す
     * @returns 認証状態
     */
    public get authenticationState(): AuthState {
        return this._authState;
    }

    /**
     * ソケットをバインドするPromiseラッパー
     * @param socket - バインドするソケット
     * @param port - バインドするポート番号
     * @param address - バインドするアドレス
     * @returns バインド完了のPromise
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
     * 全non-internal IPv4アダプタにソケットを作成し、即座にresolveする
     * Master OptIn検出時にアダプタ収束を行う
     */
    public async connect(): Promise<void> {
        // 二重呼び出し防止
        if (this.detectingAdapter || this.broadcastSockets.size > 0 || this.broadcastSocket !== null) {
            throw new Error("Already connected or connecting");
        }

        // non-internal + IPv4アダプタを取得
        const adapters = listNetworkAdapters().filter((a) => findIPv4Address(a) !== undefined);
        if (adapters.length === 0) {
            throw new Error("No non-internal IPv4 network adapters found");
        }

        this.detectingAdapter = true;

        try {
            // unicastソケット (1つだけ)
            this.unicastSocket = createSocket({ type: "udp4", reuseAddr: false }, this.receiveUnicast.bind(this));
            await this.bindSocket(this.unicastSocket, this.config.unicastPort, "0.0.0.0");

            // 各アダプタにbroadcast/timestampソケットを作成
            for (const adapter of adapters) {
                const ipv4 = findIPv4Address(adapter);
                if (!ipv4) continue;

                this.adapterMap.set(adapter.name, adapter);

                const bSocket = createSocket({ type: "udp4", reuseAddr: true }, (msg: Buffer, rinfo: RemoteInfo) =>
                    this.receiveBroadcast(msg, rinfo, adapter.name),
                );
                await this.bindSocket(bSocket, TCNET_BROADCAST_PORT, ipv4.address);
                bSocket.setBroadcast(true);
                this.broadcastSockets.set(adapter.name, bSocket);

                const tSocket = createSocket({ type: "udp4", reuseAddr: true }, this.receiveTimestamp.bind(this));
                await this.bindSocket(tSocket, TCNET_TIMESTAMP_PORT, ipv4.address);
                tSocket.setBroadcast(true);
                this.timestampSockets.set(adapter.name, tSocket);
            }
        } catch (err) {
            await this.disconnectSockets();
            throw err;
        }

        // OptIn送信開始 (全アダプタ)
        await this.announceApp();
        this.announcementInterval = setInterval(() => {
            this.announceApp().catch((err) => {
                const error = err instanceof Error ? err : new Error(String(err));
                this.log?.error(error);
            });
        }, 1000);

        // 検出タイムアウト
        if (this.config.detectionTimeout > 0) {
            this.detectionTimeoutId = setTimeout(() => {
                this.detectionTimeoutId = null;
                if (!this.connected) {
                    this.emit("detectionTimeout");
                }
            }, this.config.detectionTimeout);
        }
    }

    /**
     * ソケットをクローズしてインターバルを停止する (リスナーは維持する)
     * switchAdapter() のようにリスナーを維持したまま切断する場合に使用する
     */
    private async disconnectSockets(): Promise<void> {
        if (this.announcementInterval) {
            clearInterval(this.announcementInterval);
            this.announcementInterval = null;
        }
        this.connected = false;
        this._selectedAdapter = null;
        this.server = null;
        this.detectingAdapter = false;
        this.resetAuthSession();
        if (this.connectTimeoutId) {
            clearTimeout(this.connectTimeoutId);
            this.connectTimeoutId = null;
        }
        if (this.detectionTimeoutId) {
            clearTimeout(this.detectionTimeoutId);
            this.detectionTimeoutId = null;
        }
        // waitConnected()のPromiseが宙吊りにならないようrejectしてからnull化する
        const rejectHandler = this.connectedReject;
        this.connectedHandler = null;
        this.connectedReject = null;
        if (rejectHandler) {
            rejectHandler(new Error("Disconnected"));
        }

        const closePromises: Promise<void>[] = [];
        for (const socket of this.broadcastSockets.values()) {
            closePromises.push(closeSocket(socket));
        }
        for (const socket of this.timestampSockets.values()) {
            closePromises.push(closeSocket(socket));
        }
        this.broadcastSockets.clear();
        this.timestampSockets.clear();
        this.adapterMap.clear();

        if (this.broadcastSocket) {
            closePromises.push(closeSocket(this.broadcastSocket));
            this.broadcastSocket = null;
        }
        if (this.timestampSocket) {
            closePromises.push(closeSocket(this.timestampSocket));
            this.timestampSocket = null;
        }
        if (this.unicastSocket) {
            closePromises.push(closeSocket(this.unicastSocket));
            this.unicastSocket = null;
        }

        await Promise.all(closePromises).catch((err) => {
            const error = new Error("Error disconnecting sockets");
            error.cause = err instanceof Error ? err : new Error(String(err));
            this.log?.error(error);
        });
    }

    /**
     * TCNetネットワークから切断する
     * ソケットを閉じ、全リスナーを削除する
     */
    public async disconnect(): Promise<void> {
        this.switching = false;
        await this.disconnectSockets();
        this.removeAllListeners();
    }

    /**
     * Masterからのユニキャストを待機する
     * @param timeoutMs - タイムアウト(ms)。省略時はdetectionTimeoutを使用
     * @returns 接続完了のPromise
     */
    private waitConnected(timeoutMs?: number): Promise<void> {
        return new Promise((resolve, reject) => {
            this.connectedHandler = resolve;
            this.connectedReject = reject;

            const timeout = timeoutMs ?? this.config.detectionTimeout;
            if (timeout > 0) {
                this.connectTimeoutId = setTimeout(() => {
                    this.connectTimeoutId = null;
                    if (!this.connected) {
                        reject(new Error("Timeout connecting to network"));
                    }
                }, timeout);
            }
        });
    }

    /**
     * Master検出時に該当アダプタに収束し、他のアダプタのソケットを閉じる
     * @param adapterName - 収束先のアダプタ名
     * @param rinfo - Master送信元情報
     * @param listenerPort - Masterのリスナーポート
     */
    private async convergeToAdapter(adapterName: string, rinfo: RemoteInfo, listenerPort: number): Promise<void> {
        if (this.connected) return; // 先着優先

        const adapter = this.adapterMap.get(adapterName);
        if (!adapter) return;

        this._selectedAdapter = adapter;
        this.config.broadcastAddress = interfaceAddress(adapterName);
        this.server = rinfo;
        this.server.port = listenerPort;
        this.detectingAdapter = false;
        this.connected = true;

        if (this.detectionTimeoutId) {
            clearTimeout(this.detectionTimeoutId);
            this.detectionTimeoutId = null;
        }

        // 確定アダプタのソケットを単一変数に移行
        this.broadcastSocket = this.broadcastSockets.get(adapterName) ?? null;
        this.timestampSocket = this.timestampSockets.get(adapterName) ?? null;

        // 他アダプタのソケットを閉じる
        const closePromises: Promise<void>[] = [];
        for (const [name, socket] of this.broadcastSockets) {
            if (name !== adapterName) closePromises.push(closeSocket(socket));
        }
        for (const [name, socket] of this.timestampSockets) {
            if (name !== adapterName) closePromises.push(closeSocket(socket));
        }
        this.broadcastSockets.clear();
        this.timestampSockets.clear();
        this.adapterMap.clear();

        await Promise.all(closePromises).catch((err) => {
            this.log?.debug(`Error closing non-selected sockets: ${err}`);
        });

        this.emit("adapterSelected", adapter);
    }

    /**
     * 指定アダプタのみにソケットを作成してMaster検出を待つ。
     * switchAdapter()から使用される内部メソッド
     * @param adapterName - 接続先のアダプタ名
     */
    private async connectToAdapter(adapterName: string): Promise<void> {
        const adapter = listNetworkAdapters().find((a) => a.name === adapterName);
        if (!adapter) throw new Error(`Interface ${adapterName} does not exist`);

        const ipv4 = findIPv4Address(adapter);
        if (!ipv4) throw new Error(`Interface ${adapterName} does not have IPv4 address`);

        const broadcastAddr = interfaceAddress(adapterName);

        // 単一アダプタ用ソケット作成 (adapterName引数なし -> connectToAdapter経由と識別)
        this.broadcastSocket = createSocket({ type: "udp4", reuseAddr: true }, (msg: Buffer, rinfo: RemoteInfo) =>
            this.receiveBroadcast(msg, rinfo),
        );
        await this.bindSocket(this.broadcastSocket, TCNET_BROADCAST_PORT, ipv4.address);
        this.broadcastSocket.setBroadcast(true);

        this.timestampSocket = createSocket({ type: "udp4", reuseAddr: true }, this.receiveTimestamp.bind(this));
        await this.bindSocket(this.timestampSocket, TCNET_TIMESTAMP_PORT, ipv4.address);
        this.timestampSocket.setBroadcast(true);

        this.unicastSocket = createSocket({ type: "udp4", reuseAddr: false }, this.receiveUnicast.bind(this));
        await this.bindSocket(this.unicastSocket, this.config.unicastPort, "0.0.0.0");

        this.config.broadcastAddress = broadcastAddr;

        // selectedAdapterをwaitConnected前にセットし、resolveまでに値が入るようにする (#13)
        this._selectedAdapter = adapter;

        // OptIn送信開始
        await this.announceApp();
        this.announcementInterval = setInterval(() => {
            this.announceApp().catch((err) => {
                const error = err instanceof Error ? err : new Error(String(err));
                this.log?.error(error);
            });
        }, 1000);

        // Master検出を待つ (detectionTimeout=0でもhangしないようrequestTimeoutをフォールバック)
        await this.waitConnected(this.config.requestTimeout);
    }

    /**
     * 管理ヘッダーからパケットをパースする
     * @param header - 受信した管理ヘッダー
     * @returns パースされたパケット。不正な場合はnull
     */
    private parsePacket(header: nw.TCNetManagementHeader): nw.TCNetPacket | null {
        const packetClass = nw.TCNetPackets[header.messageType];
        if (packetClass !== null) {
            const packet = new packetClass();
            // 可変長メッセージはバッファから長さを判定する必要があるため、
            // length()の前にbufferとheaderを設定する
            packet.buffer = header.buffer;
            packet.header = header;

            if (packet.length() !== -1 && packet.length() !== header.buffer.length) {
                this.log?.debug(
                    `${
                        nw.TCNetMessageTypeName[header.messageType]
                    } packet has the wrong length (expected: ${packet.length()}, received: ${header.buffer.length})`,
                );
                return null;
            }
            packet.read();

            return packet;
        } else {
            this.log?.debug(
                `Unknown packet type: ${header.messageType} ${nw.TCNetMessageTypeName[header.messageType]}`,
            );
        }
        return null;
    }

    /**
     * ブロードキャストソケットのデータグラム受信コールバック
     * @param msg - データグラムバッファ
     * @param rinfo - 送信元情報
     * @param adapterName - 受信したアダプタ名 (connect()経由の場合のみ設定)
     */
    private receiveBroadcast(msg: Buffer, rinfo: RemoteInfo, adapterName?: string): void {
        const mgmtHeader = new nw.TCNetManagementHeader(msg);
        mgmtHeader.read();
        const packet: nw.TCNetPacket | null = this.parsePacket(mgmtHeader);

        if (packet) {
            if (packet instanceof nw.TCNetOptInPacket) {
                if (mgmtHeader.nodeType == nw.NodeType.Master) {
                    if (!this.connected && this.detectingAdapter && adapterName) {
                        // 検出中 (connect()経由): アダプタ収束
                        this.convergeToAdapter(adapterName, rinfo, packet.nodeListenerPort);
                    } else if (!this.connected && !this.detectingAdapter) {
                        // 単一アダプタ接続中 (connectToAdapter()経由): waitConnected解決
                        this.server = rinfo;
                        this.server.port = packet.nodeListenerPort;
                        this.connected = true;
                        if (this.connectedHandler) {
                            this.connectedHandler();
                            this.connectedHandler = null;
                        }
                    } else if (this.connected) {
                        // 確定後: 従来通りserver更新
                        this.server = rinfo;
                        this.server.port = packet.nodeListenerPort;
                    }
                }
            }

            if (packet instanceof nw.TCNetOptOutPacket) {
                if (mgmtHeader.nodeType == nw.NodeType.Master) {
                    // MasterからOptOutパケットを受信した
                    this.log?.debug("Received optout from current Master");
                    if (this.server?.address == rinfo.address && this.server?.port == packet.nodeListenerPort) {
                        this.server = null;
                        this.resetAuthSession();
                    }
                }
            }

            if (this.connected) {
                this.handleAuthPacket(packet, rinfo);
                this.emit("broadcast", packet);
            }
        } else {
            this.log?.debug(`Unknown broadcast packet type: ${mgmtHeader.messageType}`);
        }
    }

    /**
     * ユニキャストソケットのデータグラム受信コールバック
     * @param msg - データグラムバッファ
     * @param rinfo - 送信元情報
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

                    if (complete) {
                        // T8: アセンブル完了時のみ emit する (未完パケットは emit しない)
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
                        if (this.connected) {
                            this.emit("data", finalPacket);
                        }
                        pendingRequest.resolve(finalPacket);
                    } else {
                        // パケット到着ごとにタイムアウトをリセット (emit しない)
                        clearTimeout(pendingRequest.timeout);
                        pendingRequest.timeout = setTimeout(() => {
                            if (this.requests.delete(key)) {
                                // T2: タイムアウト時にアセンブラのメモリをクリーンアップする
                                pendingRequest.assembler?.reset();
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
            // ユニキャスト経由でOptInを直接受信 -> 宛先に登録された
            if (mgmtHeader.nodeType == nw.NodeType.Master) {
                // MasterからOptInを受信 -> Pro DJ Link Bridge等に登録された
                this.server = rinfo;
                this.server.port = packet.nodeListenerPort;
                if (this.connectedHandler) {
                    this.connected = true;

                    this.connectedHandler();
                    this.connectedHandler = null;
                }
            }
        } else {
            this.handleAuthPacket(packet, rinfo);
            if (this.connected) {
                this.emit("broadcast", packet);
            }
        }
    }

    /**
     * タイムスタンプソケットのデータグラム受信コールバック
     * @param msg - データグラムバッファ
     * @param _rinfo - 送信元情報 (未使用)
     */
    private receiveTimestamp(msg: Buffer, _rinfo: RemoteInfo): void {
        // アダプタ確定前はtimeイベントを発火しない
        if (!this.connected) return;

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
     * パケットにヘッダー情報を設定する
     * @param packet - ヘッダーを設定するパケット
     * @param nodeOptions - ノードオプション。省略時はxteaCiphertext有無で自動決定
     */
    private fillHeader(packet: nw.TCNetPacket, nodeOptions?: number): void {
        packet.header = new nw.TCNetManagementHeader(packet.buffer);

        packet.header.minorVersion = 5;
        packet.header.nodeId = this.config.nodeId;
        packet.header.messageType = packet.type() as nw.TCNetMessageType;
        packet.header.nodeName = this.config.nodeName;
        packet.header.seq = this.seq = (this.seq + 1) % 255;
        packet.header.nodeType = 0x04;
        packet.header.nodeOptions = nodeOptions ?? (this.hasValidXteaCiphertext() ? 0x0007 : 0x0000);
        packet.header.timestamp = 0;
    }

    /**
     * 指定ソケットで指定宛先にパケットを送信する
     * @param packet - 送信するパケット
     * @param socket - 送信に使用するソケット
     * @param port - 宛先ポート番号
     * @param address - 宛先アドレス
     * @param nodeOptions - ノードオプション。省略時はconfig.nodeOptionsを使用
     * @returns 送信完了のPromise
     */
    private sendPacket(
        packet: nw.TCNetPacket,
        socket: Socket,
        port: number,
        address: string,
        nodeOptions?: number,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const buffer = Buffer.alloc(packet.length());
            packet.buffer = buffer;
            this.fillHeader(packet, nodeOptions);

            packet.header.write();
            packet.write();
            socket.send(buffer, port, address, (err) => {
                if (err) reject(err);
                resolve();
            });
        });
    }

    /**
     * 検出済みサーバーにパケットを送信する
     * @param packet - 送信するパケット
     */
    public async sendServer(packet: nw.TCNetPacket): Promise<void> {
        if (this.switching) {
            throw new Error("Cannot send while switching adapter");
        }
        if (this.server === null) {
            throw new Error("Server not yet discovered");
        }
        if (!this.broadcastSocket) {
            throw new Error("Adapter not yet selected");
        }

        await this.sendPacket(packet, this.broadcastSocket, this.server.port, this.server.address);
    }

    /**
     * 毎秒ネットワークに自アプリを告知する
     * アダプタ確定後は単一ソケットで送信し、検出中は全アダプタに送信する
     */
    private async announceApp(): Promise<void> {
        const optInPacket = new nw.TCNetOptInPacket();
        optInPacket.nodeCount = 0;
        optInPacket.nodeListenerPort = this.config.unicastPort;
        optInPacket.uptime = this.uptime++;

        // 仕様書に従い、uptimeは12時間でロールオーバーする
        if (this.uptime >= 12 * 60 * 60) {
            this.uptime = 0;
        }

        optInPacket.vendorName = this.config.vendorName;
        optInPacket.appName = this.config.appName;
        optInPacket.majorVersion = 1;
        optInPacket.minorVersion = 1;
        optInPacket.bugVersion = 1;

        if (this.broadcastSocket) {
            // 確定後: 単一ソケットで直接送信 (公開APIのガードを経由しない)
            await this.sendPacket(
                optInPacket,
                this.broadcastSocket,
                TCNET_BROADCAST_PORT,
                this.config.broadcastAddress,
            );
            if (this.server) {
                await this.sendPacket(optInPacket, this.broadcastSocket, this.server.port, this.server.address);
            }
        } else {
            // 検出中: 全アダプタに並列送信
            await Promise.all(
                [...this.broadcastSockets.entries()].map(([name, socket]) => {
                    const broadcastAddr = interfaceAddress(name);
                    return this.sendPacket(optInPacket, socket, TCNET_BROADCAST_PORT, broadcastAddr);
                }),
            );
        }
    }

    /**
     * ネットワークにパケットをブロードキャストする
     * @param packet - ブロードキャストするパケット
     */
    public async broadcastPacket(packet: nw.TCNetPacket): Promise<void> {
        if (this.switching) {
            throw new Error("Cannot broadcast while switching adapter");
        }
        if (!this.broadcastSocket) {
            throw new Error("Adapter not yet selected");
        }
        await this.sendPacket(packet, this.broadcastSocket, TCNET_BROADCAST_PORT, this.config.broadcastAddress);
    }

    /**
     * アダプタを切り替える。
     * pendingリクエストをrejectし、ソケットを再接続する
     * @param interfaceName - 切り替え先のネットワークインターフェース名
     */
    public async switchAdapter(interfaceName: string): Promise<void> {
        // バリデーション
        const adapters = listNetworkAdapters();
        const adapter = adapters.find((a) => a.name === interfaceName);
        if (!adapter) {
            throw new Error(`Interface ${interfaceName} does not exist`);
        }
        if (!findIPv4Address(adapter)) {
            throw new Error(`Interface ${interfaceName} does not have IPv4 address`);
        }

        this.switching = true;

        // pendingリクエストをreject
        for (const [, req] of this.requests) {
            clearTimeout(req.timeout);
            req.assembler?.reset();
            req.reject(new Error("Connection switching"));
        }
        this.requests.clear();

        // ソケット切断 (リスナー維持)
        await this.disconnectSockets();

        // config更新
        this.config.broadcastInterface = interfaceName;

        // リトライ付き単一アダプタ接続
        let lastError: Error | undefined;
        const maxAttempts = 1 + this.config.switchRetryCount;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (!this.switching) {
                throw new Error("Switch interrupted by disconnect");
            }
            try {
                await this.connectToAdapter(interfaceName);
                this.switching = false;
                this.emit("adapterSelected", adapter);
                return;
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                await this.disconnectSockets();
                this.log?.debug(`switchAdapter retry ${attempt + 1}/${maxAttempts} failed: ${lastError.message}`);
                if (attempt < maxAttempts - 1 && this.switching) {
                    await new Promise((r) => setTimeout(r, this.config.switchRetryInterval));
                }
            }
        }

        this.switching = false;
        throw new Error(`Failed to switch adapter after ${maxAttempts} attempts: ${lastError?.message}`);
    }

    /**
     * クライアントのIPアドレスを取得する
     * @returns IPアドレス文字列。未選択の場合はnull
     */
    private getClientIp(): string | null {
        if (this._selectedAdapter) {
            const ipv4 = findIPv4Address(this._selectedAdapter);
            return ipv4?.address ?? null;
        }
        return null;
    }

    /**
     * AppDataパケットを生成する
     * @param cmd - コマンド番号
     * @param token - セッショントークン
     * @param payload - 認証ペイロード (12バイト)
     * @returns 生成したパケット
     */
    private createAppDataPacket(cmd: number, token: number, payload: Buffer): nw.TCNetApplicationDataPacket {
        const packet = new nw.TCNetApplicationDataPacket();
        packet.dest = 0xffff;
        packet.subType = 0x14;
        packet.field1 = 1;
        packet.field2 = 1;
        packet.fixedValue = 0x0aa0;
        packet.cmd = cmd;
        packet.listenerPort = this.config.unicastPort;
        packet.token = token;
        packet.payload = payload;
        return packet;
    }

    /**
     * xteaCiphertextが有効な16桁hex文字列であるか検証する
     * @returns 有効な場合true
     */
    private hasValidXteaCiphertext(): boolean {
        const ct = this.config.xteaCiphertext;
        return !!ct && /^[0-9a-f]{16}$/i.test(ct);
    }

    /** 認証セッションをリセットする (再試行可能な状態に戻す) */
    private resetAuthSession(): void {
        this._authState = "none";
        this.sessionToken = null;
        if (this.authTimeoutId) {
            clearTimeout(this.authTimeoutId);
            this.authTimeoutId = null;
        }
    }

    /**
     * 認証シーケンスを送信する
     * cmd=0 (hello) の後に50ms待機してcmd=2 (認証) を送信する。
     * 実機テストの結果、AppDataはbroadcastSocket(60000)経由でブロードキャストアドレスに送信する。
     */
    private async sendAuthSequence(): Promise<void> {
        if (!this.server || !this.broadcastSocket || this.sessionToken === null) {
            this.resetAuthSession();
            return;
        }

        if (!this.hasValidXteaCiphertext()) {
            this.log?.debug(`Invalid xteaCiphertext (expected 16-digit hex): "${this.config.xteaCiphertext ?? ""}"`);
            this.resetAuthSession();
            return;
        }
        const ct = this.config.xteaCiphertext!;

        // cmd=0 (hello) をブロードキャストアドレス:60000に送信
        const hello = this.createAppDataPacket(0, 0, Buffer.alloc(12));
        await this.sendPacket(hello, this.broadcastSocket, TCNET_BROADCAST_PORT, this.config.broadcastAddress);

        // 50ms待機してcmd=2 (認証) を送信
        await new Promise((r) => setTimeout(r, 50));

        if (!this.server || !this.broadcastSocket) {
            this.resetAuthSession();
            return;
        }

        const clientIp = this.getClientIp();
        if (!clientIp) {
            this.resetAuthSession();
            return;
        }

        const ciphertext = Buffer.from(ct, "hex");
        const payload = generateAuthPayload(this.sessionToken, clientIp, ciphertext);
        const auth = this.createAppDataPacket(2, this.sessionToken, payload);
        await this.sendPacket(auth, this.broadcastSocket, TCNET_BROADCAST_PORT, this.config.broadcastAddress);
    }

    /**
     * 受信パケットから認証ハンドシェイクを処理する
     * AppData cmd=1でトークンを取得し、Error応答で認証成否を判定する
     * @param packet - 受信したパケット
     * @param rinfo - 送信元情報
     */
    private handleAuthPacket(packet: nw.TCNetPacket | null, rinfo: RemoteInfo): void {
        if (!packet || !this.hasValidXteaCiphertext()) return;
        if (!this.server || rinfo.address !== this.server.address) return;

        if (packet instanceof nw.TCNetApplicationDataPacket) {
            if (packet.cmd === 1 && this.sessionToken === null && this._authState === "none") {
                this.sessionToken = packet.token;
                this._authState = "pending";
                this.log?.debug(`Auth token received: 0x${packet.token.toString(16).padStart(8, "0")}`);
                this.authTimeoutId = setTimeout(() => {
                    if (this._authState === "pending") {
                        this.log?.debug("TCNASDP authentication timed out");
                        this.resetAuthSession();
                    }
                }, AUTH_RESPONSE_TIMEOUT);
                this.sendAuthSequence().catch((err) => {
                    this.resetAuthSession();
                    const error = err instanceof Error ? err : new Error(String(err));
                    this.log?.error(error);
                });
            }
        } else if (packet instanceof nw.TCNetErrorPacket) {
            if (this._authState !== "pending" || packet.errorData.length < 3) return;

            const b0 = packet.errorData[0];
            const b1 = packet.errorData[1];
            const b2 = packet.errorData[2];

            if (b0 === 0xff && b1 === 0xff && b2 === 0xff) {
                if (this.authTimeoutId) {
                    clearTimeout(this.authTimeoutId);
                    this.authTimeoutId = null;
                }
                this._authState = "authenticated";
                this.log?.debug("TCNASDP authentication succeeded");
                this.emit("authenticated");
            } else if (b0 === 0xff && b1 === 0xff && b2 === 0x0d) {
                if (this.authTimeoutId) {
                    clearTimeout(this.authTimeoutId);
                    this.authTimeoutId = null;
                }
                this._authState = "failed";
                this.log?.debug("TCNASDP authentication failed");
                this.emit("authFailed");
            }
        }
    }

    /**
     * データリクエストをブロードキャストで送信する
     *
     * 実機テストの結果、RequestパケットはbroadcastSocket(60000)経由で
     * ブロードキャストアドレス:60000に送信しnodeOptions=0x0000を使用する必要がある。
     * @param dataType - 要求するデータタイプ
     * @param layer - 要求するレイヤー (0-7)
     * @returns リクエスト応答のPromise
     */
    public requestData(dataType: number, layer: number): Promise<nw.TCNetDataPacket> {
        return new Promise((resolve, reject) => {
            if (!Number.isInteger(layer) || layer < 0 || layer > 7) {
                reject(new RangeError("layer must be an integer between 0 and 7"));
                return;
            }

            if (this.switching) {
                reject(new Error("Cannot request while switching adapter"));
                return;
            }

            if (!this.broadcastSocket) {
                reject(new Error("Adapter not yet selected"));
                return;
            }

            const request = new nw.TCNetRequestPacket();
            request.dataType = dataType;
            request.layer = layer + 1; // APIは0-based、仕様は1-based

            const key = `${dataType}-${layer}`;
            const timeout = setTimeout(() => {
                // T2: delete前にreqを取得し、アセンブラのメモリをクリーンアップする
                const req = this.requests.get(key);
                if (req && this.requests.delete(key)) {
                    req.assembler?.reset();
                    reject(new Error("Timeout while requesting data"));
                }
            }, this.config.requestTimeout);

            this.requests.set(key, {
                resolve,
                reject,
                timeout,
                assembler: MULTI_PACKET_TYPES.has(dataType) ? new MultiPacketAssembler() : undefined,
            });

            // broadcastSocket(60000)からbroadcast:60000に送信、nodeOptions=0x0000
            this.sendPacket(
                request,
                this.broadcastSocket,
                TCNET_BROADCAST_PORT,
                this.config.broadcastAddress,
                0x0000,
            ).catch((err) => {
                if (this.requests.delete(key)) {
                    clearTimeout(timeout);
                    reject(err);
                }
            });
        });
    }
}
