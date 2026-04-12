/**
 * CUEポイントの情報を表す型
 * @category Types
 */
export type CuePoint = {
    index: number;
    type: number;
    inTime: number;
    outTime: number;
    color: { r: number; g: number; b: number };
};

/**
 * CUEデータを表す型
 * @category Types
 */
export type CueData = {
    loopInTime: number;
    cues: CuePoint[];
};

/**
 * 波形の1バーを表す型
 * @category Types
 */
export type WaveformBar = {
    color: number;
    level: number;
};

/**
 * 波形データを表す型
 * @category Types
 */
export type WaveformData = {
    bars: WaveformBar[];
};

/**
 * ビートグリッドの1エントリを表す型
 * @category Types
 */
export type BeatGridEntry = {
    beatNumber: number;
    beatType: number;
    timestampMs: number;
};

/**
 * ビートグリッドデータを表す型
 * @category Types
 */
export type BeatGridData = {
    entries: BeatGridEntry[];
};

/**
 * ミキサーの1チャンネルを表す型
 * @category Types
 */
export type MixerChannel = {
    sourceSelect: number;
    audioLevel: number;
    faderLevel: number;
    trimLevel: number;
    compLevel: number;
    eqHi: number;
    eqHiMid: number;
    eqLowMid: number;
    eqLow: number;
    filterColor: number;
    send: number;
    cueA: number;
    cueB: number;
    crossFaderAssign: number;
};

/**
 * アートワークデータを表す型
 * @category Types
 */
export type ArtworkData = {
    jpeg: Buffer;
};

/**
 * ミキサーデータを表す型
 * @category Types
 */
export type MixerData = {
    mixerId: number;
    mixerType: number;
    mixerName: string;
    masterAudioLevel: number;
    masterFaderLevel: number;
    masterFilter: number;
    micEqHi: number;
    micEqLow: number;
    linkCueA: number;
    linkCueB: number;
    masterCueA: number;
    masterCueB: number;
    masterIsolatorOn: boolean;
    masterIsolatorHi: number;
    masterIsolatorMid: number;
    masterIsolatorLow: number;
    filterHpf: number;
    filterLpf: number;
    filterResonance: number;
    sendFxEffect: number;
    sendFxExt1: number;
    sendFxExt2: number;
    sendFxMasterMix: number;
    sendFxSizeFeedback: number;
    sendFxTime: number;
    sendFxHpf: number;
    sendFxLevel: number;
    sendReturn3Source: number;
    sendReturn3Type: number;
    sendReturn3On: number;
    sendReturn3Level: number;
    channelFaderCurve: number;
    crossFaderCurve: number;
    crossFader: number;
    beatFxOn: boolean;
    beatFxLevelDepth: number;
    beatFxChannelSelect: number;
    beatFxSelect: number;
    beatFxFreqHi: number;
    beatFxFreqMid: number;
    beatFxFreqLow: number;
    headphonesPreEq: number;
    headphonesALevel: number;
    headphonesAMix: number;
    headphonesBLevel: number;
    headphonesBMix: number;
    boothLevel: number;
    boothEqHi: number;
    boothEqLow: number;
    channels: MixerChannel[];
};
