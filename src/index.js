export const MIN_CAPACITY = 1;
export const MAX_CAPACITY = 64;
export const DEFAULT_CAPACITY = 8;
export const DEFAULT_RTT_RATIO = 2;
export const DEFAULT_OUTLIER_MULTIPLE = 3;
export const OUTLIER_MIN_SAMPLES = 3;

const OPTIONS_MESSAGE = "options must be an object";
const SAMPLE_MESSAGE = "sample must be an object";
const CAPACITY_MESSAGE = "capacity must be an integer from 1 to 64";
const RTT_RATIO_MESSAGE = "rttRatio must be Infinity or a finite number greater than or equal to 1";
const OUTLIER_MULTIPLE_MESSAGE =
  "outlierMultiple must be a finite number greater than or equal to 0";
const CLIENT_SEND_MESSAGE = "clientSend must be a finite number";
const SERVER_STAMP_MESSAGE = "serverTime must be a finite number";
const CLIENT_RECEIVE_MESSAGE = "clientReceive must be a finite number";
const ORDER_MESSAGE = "clientReceive must be greater than or equal to clientSend";
const RTT_MESSAGE = "round-trip time must be finite";
const MIDPOINT_MESSAGE = "sample midpoint must be finite";
const OFFSET_MESSAGE = "sample offset must be finite";
const SPREAD_MESSAGE = "spread must be finite";
const LOCAL_TIME_MESSAGE = "localTime must be a finite number";
const NO_OFFSET_MESSAGE = "no clock offset has been estimated";
const SERVER_TIME_MESSAGE = "server time must be finite";

function assertObject(value, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(message);
  }
}

function readOptional(object, key) {
  if (!Object.hasOwn(object, key)) {
    return undefined;
  }
  return object[key];
}

function zero(value) {
  return value === 0 ? 0 : value;
}

function readCapacity(options) {
  const value = readOptional(options, "capacity");
  if (value === undefined) {
    return DEFAULT_CAPACITY;
  }
  if (!Number.isInteger(value) || value < MIN_CAPACITY || value > MAX_CAPACITY) {
    throw new RangeError(CAPACITY_MESSAGE);
  }
  return value;
}

function readRttRatio(options) {
  const value = readOptional(options, "rttRatio");
  if (value === undefined) {
    return DEFAULT_RTT_RATIO;
  }
  if (
    value !== Number.POSITIVE_INFINITY &&
    (typeof value !== "number" || !Number.isFinite(value) || value < 1)
  ) {
    throw new RangeError(RTT_RATIO_MESSAGE);
  }
  return value;
}

function readOutlierMultiple(options) {
  const value = readOptional(options, "outlierMultiple");
  if (value === undefined) {
    return DEFAULT_OUTLIER_MULTIPLE;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(OUTLIER_MULTIPLE_MESSAGE);
  }
  return zero(value);
}

function readFinite(object, key, message) {
  if (!Object.hasOwn(object, key)) {
    throw new RangeError(message);
  }
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(message);
  }
  return zero(value);
}

function compareNumbers(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareByRttThenNewer(left, right) {
  if (left.sample.rtt < right.sample.rtt) {
    return -1;
  }
  if (left.sample.rtt > right.sample.rtt) {
    return 1;
  }
  if (left.index > right.index) {
    return -1;
  }
  if (left.index < right.index) {
    return 1;
  }
  return 0;
}

function median(values) {
  const sorted = values.slice();
  sorted.sort(compareNumbers);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  const sum = sorted[mid - 1] + sorted[mid];
  if (!Number.isFinite(sum)) {
    return sum;
  }
  return sum / 2;
}

function eligibleSamples(ranked, rttRatio) {
  if (rttRatio === Number.POSITIVE_INFINITY) {
    return ranked;
  }
  const limit = ranked[0].sample.rtt * rttRatio;
  if (!Number.isFinite(limit)) {
    return ranked;
  }
  const eligible = [];
  for (const entry of ranked) {
    if (entry.sample.rtt <= limit) {
      eligible.push(entry);
    }
  }
  return eligible;
}

function selectSurvivors(eligible, outlierMultiple) {
  if (eligible.length < OUTLIER_MIN_SAMPLES) {
    return eligible;
  }
  const offsets = [];
  for (const entry of eligible) {
    offsets.push(entry.sample.offset);
  }
  const middle = median(offsets);
  if (typeof middle !== "number" || !Number.isFinite(middle)) {
    return eligible;
  }
  const deviations = [];
  for (const offset of offsets) {
    deviations.push(Math.abs(offset - middle));
  }
  const deviation = median(deviations);
  if (typeof deviation !== "number" || !Number.isFinite(deviation)) {
    return eligible;
  }
  const limit = outlierMultiple * deviation;
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return eligible;
  }
  const kept = [];
  for (let index = 0; index < eligible.length; index += 1) {
    if (deviations[index] <= limit) {
      kept.push(eligible[index]);
    }
  }
  if (kept.length === 0) {
    return eligible;
  }
  return kept;
}

function survivorHasIndex(survivors, index) {
  for (const entry of survivors) {
    if (entry.index === index) {
      return true;
    }
  }
  return false;
}

function estimateWindow(samples, rttRatio, outlierMultiple) {
  const ranked = [];
  for (let index = 0; index < samples.length; index += 1) {
    ranked.push({
      sample: samples[index],
      index
    });
  }
  ranked.sort(compareByRttThenNewer);
  const eligible = eligibleSamples(ranked, rttRatio);
  const survivors = selectSurvivors(eligible, outlierMultiple);
  const chosen = survivors[0];
  let disagreement = 0;
  for (const entry of survivors) {
    const delta = Math.abs(entry.sample.offset - chosen.sample.offset);
    if (delta > disagreement) {
      disagreement = delta;
    }
  }
  return {
    offset: chosen.sample.offset,
    rtt: chosen.sample.rtt,
    spread: chosen.sample.rtt / 2 + disagreement,
    includedIndex: (index) => survivorHasIndex(survivors, index)
  };
}

function freezeSample(sample) {
  return Object.freeze({
    clientSend: sample.clientSend,
    serverTime: sample.serverTime,
    clientReceive: sample.clientReceive,
    rtt: sample.rtt,
    offset: sample.offset
  });
}

export class ClockSync {
  #capacity;
  #rttRatio;
  #outlierMultiple;
  #samples = [];
  #offset = null;
  #rtt = null;
  #spread = null;

  constructor(options = {}) {
    assertObject(options, OPTIONS_MESSAGE);
    this.#capacity = readCapacity(options);
    this.#rttRatio = readRttRatio(options);
    this.#outlierMultiple = readOutlierMultiple(options);
  }

  get capacity() {
    return this.#capacity;
  }

  get rttRatio() {
    return this.#rttRatio;
  }

  get outlierMultiple() {
    return this.#outlierMultiple;
  }

  get size() {
    return this.#samples.length;
  }

  get offset() {
    return this.#offset;
  }

  get rtt() {
    return this.#rtt;
  }

  get spread() {
    return this.#spread;
  }

  get samples() {
    const copy = [];
    for (const sample of this.#samples) {
      copy.push(freezeSample(sample));
    }
    return copy;
  }

  reset() {
    this.#samples = [];
    this.#offset = null;
    this.#rtt = null;
    this.#spread = null;
  }

  push(sample) {
    assertObject(sample, SAMPLE_MESSAGE);
    const clientSend = readFinite(sample, "clientSend", CLIENT_SEND_MESSAGE);
    const serverTime = readFinite(sample, "serverTime", SERVER_STAMP_MESSAGE);
    const clientReceive = readFinite(sample, "clientReceive", CLIENT_RECEIVE_MESSAGE);
    if (clientReceive < clientSend) {
      throw new RangeError(ORDER_MESSAGE);
    }
    const rtt = zero(clientReceive - clientSend);
    if (!Number.isFinite(rtt)) {
      throw new RangeError(RTT_MESSAGE);
    }
    const span = clientSend + clientReceive;
    if (!Number.isFinite(span)) {
      throw new RangeError(MIDPOINT_MESSAGE);
    }
    const midpoint = span / 2;
    if (!Number.isFinite(midpoint)) {
      throw new RangeError(MIDPOINT_MESSAGE);
    }
    const offset = zero(serverTime - midpoint);
    if (!Number.isFinite(offset)) {
      throw new RangeError(OFFSET_MESSAGE);
    }

    const next = this.#samples.slice();
    next.push({
      clientSend,
      serverTime,
      clientReceive,
      rtt,
      offset
    });
    if (next.length > this.#capacity) {
      next.shift();
    }
    const estimate = estimateWindow(next, this.#rttRatio, this.#outlierMultiple);
    if (!Number.isFinite(estimate.spread)) {
      throw new RangeError(SPREAD_MESSAGE);
    }
    this.#samples = next;
    this.#offset = estimate.offset;
    this.#rtt = estimate.rtt;
    this.#spread = zero(estimate.spread);
    const storedIndex = next.length - 1;
    return {
      rtt,
      offset,
      included: estimate.includedIndex(storedIndex),
      estimateOffset: this.#offset,
      estimateRtt: this.#rtt,
      spread: this.#spread
    };
  }

  serverTime(localTime) {
    if (typeof localTime !== "number" || !Number.isFinite(localTime)) {
      throw new RangeError(LOCAL_TIME_MESSAGE);
    }
    if (this.#offset === null) {
      throw new RangeError(NO_OFFSET_MESSAGE);
    }
    const sum = localTime + this.#offset;
    if (!Number.isFinite(sum)) {
      throw new RangeError(SERVER_TIME_MESSAGE);
    }
    return zero(sum);
  }
}
