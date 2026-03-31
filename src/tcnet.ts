import { Socket, createSocket, RemoteInfo } from "dgram";
import { EventEmitter } from "events";
import { execFile } from "child_process";
import { platform } from "os";
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
    warn: (message: string) => void;
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
    protected config: TCNetConfiguration;
    protected broadcastSocket: Socket | null = null;
    private unicastSocket: Socket | null = null;
    private timestampSocket: Socket | null = null;
    protected server: RemoteInfo | null = null;
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
    protected _selectedAdapter: NetworkAdapterInfo | null = null;
    private switching = false;
    private connectTimeoutId: NodeJS.Timeout | null = null;
    private detectionTimeoutId: NodeJS.Timeout | null = null;
    private detectingAdapter = false;
    protected _authState: AuthState = "none";
    protected sessionToken: number | null = null;
    private authTimeoutId: NodeJS.Timeout | null = null;
    protected bridgeIsWindows: boolean | null = null;
    // detectBridgeIsWindows の in-flight Promise を保持し並行呼び出しを single-flight 化する
    // bridgeOsDetectionTargetIp は現在 in-flight な Promise が対象としている Bridge IP であり、
    // Bridge 切り替え後の呼び出しで古い Promise を共有しないためのキーとして機能する
    private bridgeOsDetectionPromise: Promise<boolean> | null = null;
    private bridgeOsDetectionTargetIp: string | null = null;
    // authenticated 状態での sendAuthCommandOnly 連続失敗回数を記録する
    protected authResponseFailureCount: number = 0;
    // 連続失敗がこの閾値に到達したら resetAuthSession で再認証を促す
    private static readonly AUTH_RESPONSE_FAILURE_THRESHOLD = 2;

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
                        if (this.server?.address !== rinfo.address) {
                            this.bridgeIsWindows = null;
                        }
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
                    // FileパケットでtotalPackets=0の場合、アセンブラは処理できないため
                    // 単一パケットとして即座に解決する
                    const totalPackets = msg.readUInt32LE(30);
                    const isFilePacket = packet instanceof nw.TCNetFilePacket;
                    if (isFilePacket && totalPackets === 0) {
                        this.requests.delete(key);
                        clearTimeout(pendingRequest.timeout);
                        if (this.connected) {
                            this.emit("data", dataPacket);
                        }
                        pendingRequest.resolve(dataPacket);
                    } else {
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
     * BridgeのOSがWindowsであるかをpingのTTL値から検出する
     *
     * Bridge IPが自分のIPと一致する場合はos.platform()で判定する。
     * リモートの場合はpingを1回実行しTTL値をパースする (TTL > 64 → Windows)。
     * WindowsのデフォルトTTLは128、macOS/LinuxのデフォルトTTLは64であるため、
     * 同一LAN (0-1ホップ) ではこの閾値で正確に判定できる。
     * 結果はインスタンス変数にキャッシュし、セッション中1回だけ検出する。
     *
     * 連続 cmd=1 flood 等で並行呼び出しが起きた場合は、in-flight Promise を
     * 共有する single-flight パターンにより ping の重複起動を防ぐ。ただし
     * Bridge 切り替え (`server.address` 変化) 後は古い Promise を共有せず、
     * 新しい Bridge 向けに別の ping を発行する。
     * @returns Windowsならtrue、それ以外ならfalse
     */
    protected async detectBridgeIsWindows(): Promise<boolean> {
        // キャッシュヒットは in-flight 判定より優先する
        if (this.bridgeIsWindows !== null) return this.bridgeIsWindows;

        const bridgeIp = this.server?.address;
        if (!bridgeIp) {
            // serverが未設定の場合はキャッシュせず、次回の呼び出しで再検出を許可する
            return false;
        }

        // in-flight Promise は同一 Bridge IP の呼び出しに対してのみ共有する
        // (Bridge 切り替え後に古い Bridge 向けの判定を新 Bridge に渡さないため)
        if (this.bridgeOsDetectionPromise && this.bridgeOsDetectionTargetIp === bridgeIp) {
            return this.bridgeOsDetectionPromise;
        }

        this.bridgeOsDetectionTargetIp = bridgeIp;
        this.bridgeOsDetectionPromise = this.performBridgeOsDetection(bridgeIp).finally(() => {
            // 自分の起動した Promise が in-flight のまま残っている場合のみクリアする
            // (Bridge 切り替えで別の Promise に既に上書きされている場合は触らない)
            if (this.bridgeOsDetectionTargetIp === bridgeIp) {
                this.bridgeOsDetectionPromise = null;
                this.bridgeOsDetectionTargetIp = null;
            }
        });
        return this.bridgeOsDetectionPromise;
    }

    /**
     * detectBridgeIsWindows の本体ロジック。
     * single-flight 制御とは分離してあるため、直接呼び出すべきではない。
     *
     * TOCTOU ガード: 呼び出し元から渡された `bridgeIp` をキャッシュ書き込み直前に
     * 現在の `server.address` と比較する。ping 実行中に Bridge 切り替え等で
     * `server.address` が変わった場合、古い Bridge 向けの判定で
     * `bridgeIsWindows` キャッシュを上書きしない。
     * @param bridgeIp - 検出開始時にキャプチャした Bridge IP
     * @returns Windowsならtrue、それ以外ならfalse
     */
    private async performBridgeOsDetection(bridgeIp: string): Promise<boolean> {
        // IPv4フォーマットバリデーション (execFileに渡す前の防御)
        // 不正IPは確定的でないためキャッシュしない
        if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(bridgeIp)) {
            return false;
        }

        const clientIp = this.getClientIp();
        if (clientIp && bridgeIp === clientIp) {
            const result = platform() === "win32";
            // 検出開始時の bridgeIp と現在値が一致する場合のみキャッシュを更新する
            if (this.server?.address === bridgeIp) {
                this.bridgeIsWindows = result;
                this.log?.debug(`Bridge OS detected (local): ${result ? "Windows" : "non-Windows"}`);
            } else {
                this.log?.debug(
                    `Bridge OS detection: server changed during detection (${bridgeIp} -> ${this.server?.address ?? "null"}), discarding stale result`,
                );
            }
            return result;
        }

        try {
            const isWin = platform() === "win32";
            const args = isWin ? ["-n", "1", "-w", "1000", bridgeIp] : ["-c", "1", "-W", "1", bridgeIp];
            const output = await new Promise<string>((resolve, reject) => {
                execFile("ping", args, { timeout: 3000 }, (err, stdout) => {
                    if (err) reject(err);
                    else resolve(stdout);
                });
            });
            const match = output.match(/ttl[=:](\d+)/i);
            if (match) {
                const ttl = Number.parseInt(match[1], 10);
                const result = ttl > 64;
                // ping 中に server.address が変わった場合は古い判定を書き込まない
                if (this.server?.address === bridgeIp) {
                    this.bridgeIsWindows = result;
                    this.log?.debug(`Bridge OS detected (TTL=${ttl}): ${result ? "Windows" : "non-Windows"}`);
                } else {
                    this.log?.debug(
                        `Bridge OS detection: server changed during ping (${bridgeIp} -> ${this.server?.address ?? "null"}), discarding stale result`,
                    );
                }
                return result;
            } else {
                // TTL未検出は確定的でないためキャッシュせず、次回再検出を許可する
                this.log?.debug("Bridge OS detection: TTL not found in ping output, assuming non-Windows");
                return false;
            }
        } catch (err) {
            // ping失敗は確定的でないためキャッシュせず、次回再検出を許可する
            const msg = err instanceof Error ? err.message : String(err);
            this.log?.debug(`Bridge OS detection: ping failed (${msg}), assuming non-Windows`);
            return false;
        }
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
     * 認証トークンを "0xXXXXXXXX" 形式の16進文字列に整形する
     * @param token - トークン値
     * @returns 16進文字列表現
     */
    private formatToken(token: number): string {
        return `0x${token.toString(16).padStart(8, "0")}`;
    }

    /**
     * xteaCiphertextが有効な16桁hex文字列であるか検証する
     * @returns 有効な場合true
     */
    private hasValidXteaCiphertext(): boolean {
        const ct = this.config.xteaCiphertext;
        return !!ct && /^[0-9a-f]{16}$/i.test(ct);
    }

    /**
     * 認証セッションを初期状態にリセットする
     *
     * _authState/sessionToken/authResponseFailureCount/authTimeoutId を
     * 初期値に戻し、Bridge からの次の cmd=1 で再度初回認証フローに入れる
     * 状態へ戻す。bridgeIsWindows は既定でリセットされるが、Bridge の
     * 物理端末が変わらないと判断できる場合 (連続送信失敗の閾値到達等) は
     * preserveBridgeOs=true で保持することで無駄な再 ping を避けられる。
     * @param preserveBridgeOs - true の場合は bridgeIsWindows キャッシュを保持する
     */
    protected resetAuthSession(preserveBridgeOs = false): void {
        this._authState = "none";
        this.sessionToken = null;
        if (!preserveBridgeOs) {
            this.bridgeIsWindows = null;
        }
        // セッションそのものをリセットするため、連続失敗カウンタも 0 に戻す
        this.authResponseFailureCount = 0;
        if (this.authTimeoutId) {
            clearTimeout(this.authTimeoutId);
            this.authTimeoutId = null;
        }
    }

    /**
     * cmd=2 (auth) パケットの payload を生成する
     *
     * sendAuthSequence と sendAuthCommandOnly の共通ロジックを抽出したものである。
     * ガード失敗時は null を返し、呼び出し元が失敗時の扱い (リセット or 無視) を決める。
     * @returns 送信用の payload Buffer、または null (ガード失敗時)
     */
    protected async prepareAuthPayload(): Promise<Buffer | null> {
        if (!this.server || !this.broadcastSocket || this.sessionToken === null) return null;
        if (!this.hasValidXteaCiphertext()) return null;

        const clientIp = this.getClientIp();
        if (!clientIp) return null;

        const ct = this.config.xteaCiphertext!;
        const ciphertext = Buffer.from(ct, "hex");
        const tokenBeforePing = this.sessionToken;
        // Windows BridgeはXTEA暗号文をバイトリバースして読み取るため、事前にリバースして送信する
        // 初回呼び出し時のみpingが発生し最大3秒かかる (AUTH_RESPONSE_TIMEOUT=5秒内に収まる想定)
        if (await this.detectBridgeIsWindows()) {
            ciphertext.reverse();
        }

        // 非同期待機中に状態が変わった場合は中止する
        if (!this.server || !this.broadcastSocket || this.sessionToken !== tokenBeforePing) return null;

        return generateAuthPayload(this.sessionToken, clientIp, ciphertext);
    }

    /**
     * 認証シーケンス (cmd=0 hello → 50ms wait → cmd=2 auth) を送信する
     *
     * 呼び出し時点の sessionToken を内部で expectedToken としてキャプチャし、
     * 各非同期境界で `this.sessionToken !== expectedToken` を確認する。
     * 旧世代になっていたら resetAuthSession を呼ばずに return する
     * (新世代の state を壊さないため)。
     */
    protected async sendAuthSequence(): Promise<void> {
        if (!this.server || !this.broadcastSocket || this.sessionToken === null) {
            this.resetAuthSession();
            return;
        }

        if (!this.hasValidXteaCiphertext()) {
            this.log?.debug(`Invalid xteaCiphertext (expected 16-digit hex): "${this.config.xteaCiphertext ?? ""}"`);
            this.resetAuthSession();
            return;
        }

        const expectedToken = this.sessionToken;

        // cmd=0 (hello) をブロードキャストアドレス:60000に送信
        const hello = this.createAppDataPacket(0, 0, Buffer.alloc(12));
        await this.sendPacket(hello, this.broadcastSocket, TCNET_BROADCAST_PORT, this.config.broadcastAddress);
        if (this.sessionToken !== expectedToken) return;

        // 50ms待機してcmd=2 (認証) を送信
        await new Promise((r) => setTimeout(r, 50));
        if (this.sessionToken !== expectedToken) return;

        const payload = await this.prepareAuthPayload();
        if (this.sessionToken !== expectedToken) return;
        if (!payload) {
            this.resetAuthSession();
            return;
        }

        // prepareAuthPayload が non-null を返した時点で sessionToken/broadcastSocket は非 null である
        const auth = this.createAppDataPacket(2, this.sessionToken!, payload);
        await this.sendPacket(auth, this.broadcastSocket!, TCNET_BROADCAST_PORT, this.config.broadcastAddress);
    }

    /**
     * Bridge からの cmd=1 (再認証要求) に対して cmd=2 (auth) のみを送り返す
     *
     * ShowKontrol の実測挙動 (sk-ext-capture.pcapng) をエミュレートする:
     * Bridge が cmd=1 を送ってきたら SK は 1-10ms 以内に cmd=2 だけを返す。
     * 223秒間のキャプチャで 8 回の再認証サイクルが観測され、全て同一tokenで
     * 完結している (初回ハンドシェイクのみ cmd=0 hello を伴う)。
     *
     * sendAuthSequence との違い:
     * - cmd=0 (hello) を送らない (継続セッションでは不要)
     * - 50ms 待機しない
     * - 失敗時に resetAuthSession を呼ばない (authenticated 状態を維持)
     * - state 遷移を伴わない (Error 応答は handleAuthPacket の "pending" gate で
     *   弾かれるが、ここでは authenticated 状態での "continuation" として扱うため
     *   状態変更は不要)
     * @returns 実際に cmd=2 を送信した場合は true、ガード失敗で送信しなかった場合は false
     */
    protected async sendAuthCommandOnly(): Promise<boolean> {
        const payload = await this.prepareAuthPayload();
        // prepareAuthPayload が null を返した場合は送信していない旨を呼び出し元に伝える
        // (silent に成功扱いされると連続失敗カウンタのリセット判定が誤る)
        if (!payload) return false;

        // prepareAuthPayload が non-null を返した時点で sessionToken/broadcastSocket は非 null である
        const auth = this.createAppDataPacket(2, this.sessionToken!, payload);
        await this.sendPacket(auth, this.broadcastSocket!, TCNET_BROADCAST_PORT, this.config.broadcastAddress);
        return true;
    }

    /**
     * 受信パケットから認証ハンドシェイクを処理する
     * AppData cmd=1でトークンを取得し、Error応答で認証成否を判定する
     * @param packet - 受信したパケット
     * @param rinfo - 送信元情報
     */
    protected handleAuthPacket(packet: nw.TCNetPacket | null, rinfo: RemoteInfo): void {
        if (!packet || !this.hasValidXteaCiphertext()) return;
        if (!this.server || rinfo.address !== this.server.address) return;

        if (packet instanceof nw.TCNetErrorPacket) {
            this.handleAuthErrorPacket(packet);
            return;
        }

        if (!(packet instanceof nw.TCNetApplicationDataPacket) || packet.cmd !== 1) return;

        // 初回認証: sessionToken が未取得かつ未認証・失敗状態である
        if (this.sessionToken === null && (this._authState === "none" || this._authState === "failed")) {
            this.handleInitialAuthRequest(packet);
            return;
        }

        // pending 中の cmd=1 再受信: 反応型プロトコルで cmd=2 を再送する
        if (this._authState === "pending" && this.sessionToken !== null) {
            this.handlePendingReauthRequest(packet);
            return;
        }

        // 継続認証: authenticated 状態で Bridge からの再認証要求が来た場合
        if (this._authState === "authenticated" && this.sessionToken !== null) {
            this.handleReauthRequest(packet);
        }
    }

    /**
     * 初回認証: cmd=1 でトークンを受領し、認証シーケンスを送信する
     * @param packet - 受信した AppData cmd=1 パケット
     */
    private handleInitialAuthRequest(packet: nw.TCNetApplicationDataPacket): void {
        const tokenForThisAttempt = packet.token;
        this.sessionToken = tokenForThisAttempt;
        this._authState = "pending";
        this.log?.debug(`Auth token received: ${this.formatToken(tokenForThisAttempt)}`);
        this.authTimeoutId = setTimeout(() => {
            if (this._authState === "pending") {
                this.log?.debug("TCNASDP authentication timed out");
                this.resetAuthSession();
            }
        }, AUTH_RESPONSE_TIMEOUT);
        this.sendAuthSequence().catch((err) => {
            // 現世代 (pending + 同一token) の失敗のみリセットする
            // state=authenticated 遷移後の遅延 reject でセッションを破壊しないよう pending チェックを入れる
            if (this._authState === "pending" && this.sessionToken === tokenForThisAttempt) {
                this.resetAuthSession();
            }
            const error = err instanceof Error ? err : new Error(String(err));
            this.log?.error(error);
        });
    }

    /**
     * pending 中の cmd=1 再受信時の処理
     * 同一 token なら cmd=2 のみ再送、token 変化時は認証世代を刷新する
     * @param packet - 受信した AppData cmd=1 パケット
     */
    private handlePendingReauthRequest(packet: nw.TCNetApplicationDataPacket): void {
        if (packet.token !== this.sessionToken) {
            // token 変化は新しい認証世代として扱い、古い試行を完全にリセットしてから初回認証を再開する
            // (古いタイマーが新世代を早期リセットするのを防ぐ。bridgeIsWindows はセッション間で保持)
            this.log?.debug(
                `Pending auth token changed, restarting: ${this.formatToken(this.sessionToken!)} -> ${this.formatToken(packet.token)}`,
            );
            this.resetAuthSession(true);
            this.handleInitialAuthRequest(packet);
            return;
        }
        this.log?.debug("cmd=1 in pending state, resending cmd=2");
        this.sendAuthCommandOnly()
            .then((sent) => {
                if (!sent) {
                    this.log?.warn("cmd=2 resend skipped during pending (prepareAuthPayload guard failed)");
                }
            })
            .catch((err) => {
                const error = err instanceof Error ? err : new Error(String(err));
                this.log?.error(error);
            });
    }

    /**
     * 継続認証: authenticated 状態で cmd=1 を受信したときに cmd=2 で即応答する
     *
     * Bridge は client の応答が来ない場合 cmd=1 を flood し始め、最終的に
     * license timeout (~100秒) で失効する。毎回応答することで Bridge は
     * 満足し、次のサイクル (Bridge のタイミング次第で12-90秒) まで沈黙する。
     * @param packet - 受信した AppData cmd=1 パケット
     */
    private handleReauthRequest(packet: nw.TCNetApplicationDataPacket): void {
        if (packet.token !== this.sessionToken) {
            // SK の実測では常に同一 token のため、変化は想定外の状況である
            this.log?.warn(
                `Auth token changed unexpectedly: ${this.formatToken(this.sessionToken!)} -> ${this.formatToken(packet.token)}`,
            );
            this.sessionToken = packet.token;
        }
        this.log?.debug("cmd=1 in authenticated state, responding with cmd=2");
        this.sendAuthCommandOnly()
            .then((sent) => {
                // 実際に送信された場合のみ連続失敗カウンタを 0 に戻す
                // (prepareAuthPayload がガード失敗で false を返した場合はノーオペ)
                if (sent) {
                    this.authResponseFailureCount = 0;
                }
            })
            .catch((err) => {
                const error = err instanceof Error ? err : new Error(String(err));
                this.log?.error(error);
                this.authResponseFailureCount++;
                if (this.authResponseFailureCount >= TCNetClient.AUTH_RESPONSE_FAILURE_THRESHOLD) {
                    // 閾値到達時はセッションをリセットして再認証フローへ戻す
                    // bridgeIsWindows は Bridge 物理端末の OS 情報なので保持し無駄な再 ping を避ける
                    this.log?.warn(
                        `Auth response failed ${this.authResponseFailureCount} times consecutively, resetting session`,
                    );
                    this.resetAuthSession(true);
                }
            });
    }

    /**
     * Error パケットで認証成否を判定する
     * @param packet - 受信した Error パケット
     */
    private handleAuthErrorPacket(packet: nw.TCNetErrorPacket): void {
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
            this.sessionToken = null;
            this._authState = "failed";
            this.log?.debug("TCNASDP authentication failed");
            this.emit("authFailed");
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
