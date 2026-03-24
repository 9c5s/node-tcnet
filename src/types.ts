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
    loopOutTime: number;
    cues: CuePoint[];
};

/**
 * 波形の1バーを表す型
 * @category Types
 */
export type WaveformBar = {
    level: number;
    color: number;
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
    crossfaderAssign: number;
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
    masterIsolatorOn: boolean;
    masterIsolatorHi: number;
    masterIsolatorMid: number;
    masterIsolatorLow: number;
    filterHpf: number;
    filterLpf: number;
    filterResonance: number;
    crossFader: number;
    crossFaderCurve: number;
    channelFaderCurve: number;
    beatFxOn: boolean;
    beatFxSelect: number;
    beatFxLevelDepth: number;
    beatFxChannelSelect: number;
    headphonesALevel: number;
    headphonesBLevel: number;
    boothLevel: number;
    channels: MixerChannel[];
};
