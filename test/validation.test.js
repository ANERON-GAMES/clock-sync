import assert from "node:assert/strict";
import test from "node:test";
import { ClockSync } from "../src/index.js";
import { ping, snapshot } from "./helpers.js";

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

test("defaults are an eight-sample window and an empty estimate", () => {
  const sync = new ClockSync();
  assert.equal(sync.capacity, 8);
  assert.equal(sync.rttRatio, 2);
  assert.equal(sync.outlierMultiple, 3);
  assert.equal(sync.size, 0);
  assert.equal(sync.offset, null);
  assert.equal(sync.rtt, null);
  assert.equal(sync.spread, null);
  assert.deepEqual(sync.samples, []);
});

test("omitted option fields and undefined values use the defaults", () => {
  const sync = new ClockSync({
    capacity: undefined,
    rttRatio: undefined,
    outlierMultiple: undefined,
    extra: true
  });
  assert.equal(sync.capacity, 8);
  assert.equal(sync.rttRatio, 2);
  assert.equal(sync.outlierMultiple, 3);
});

test("undefined options use the defaults", () => {
  const sync = new ClockSync(undefined);
  assert.equal(sync.capacity, 8);
  assert.equal(sync.rttRatio, 2);
  assert.equal(sync.outlierMultiple, 3);
});

test("a frozen options object and a null-prototype options object are accepted", () => {
  const frozen = new ClockSync(Object.freeze({ capacity: 2, rttRatio: 4, outlierMultiple: 1 }));
  assert.equal(frozen.capacity, 2);
  assert.equal(frozen.rttRatio, 4);
  assert.equal(frozen.outlierMultiple, 1);
  const bare = Object.create(null);
  bare.capacity = 4;
  bare.rttRatio = 1;
  bare.outlierMultiple = 0;
  const sync = new ClockSync(bare);
  assert.equal(sync.capacity, 4);
  assert.equal(sync.rttRatio, 1);
  assert.equal(Object.is(sync.outlierMultiple, 0), true);
});

test("inherited option fields are ignored", () => {
  const proto = { capacity: 2, rttRatio: 9, outlierMultiple: 9 };
  const options = Object.create(proto);
  const sync = new ClockSync(options);
  assert.equal(sync.capacity, 8);
  assert.equal(sync.rttRatio, 2);
  assert.equal(sync.outlierMultiple, 3);
});

test("negative zero outlier multiple is stored as zero", () => {
  const sync = new ClockSync({ outlierMultiple: -0 });
  assert.equal(Object.is(sync.outlierMultiple, 0), true);
});

test("the constructor accepts the capacity and ratio bounds", () => {
  assert.equal(new ClockSync({ capacity: 1 }).capacity, 1);
  assert.equal(new ClockSync({ capacity: 64 }).capacity, 64);
  assert.equal(new ClockSync({ rttRatio: 1 }).rttRatio, 1);
  const open = new ClockSync({ rttRatio: Number.POSITIVE_INFINITY });
  assert.equal(open.rttRatio, Number.POSITIVE_INFINITY);
});

test("the constructor rejects an options value that is not an object", () => {
  for (const options of [null, [], "options", 1, true, false]) {
    assert.throws(() => new ClockSync(options), {
      name: "TypeError",
      message: "options must be an object"
    });
  }
});

test("the constructor rejects a capacity outside 1 through 64", () => {
  for (const capacity of [0, -0, -1, 1.5, 65, 64.5, Number.NaN, "8", null, 8n, Infinity]) {
    assert.throws(() => new ClockSync({ capacity }), {
      name: "RangeError",
      message: CAPACITY_MESSAGE
    });
  }
});

test("the constructor rejects a bad round-trip ratio", () => {
  for (const rttRatio of [0, 0.999, -1, Number.NaN, Number.NEGATIVE_INFINITY, "2", null, 2n]) {
    assert.throws(() => new ClockSync({ rttRatio }), {
      name: "RangeError",
      message: RTT_RATIO_MESSAGE
    });
  }
});

test("the constructor rejects a bad outlier multiple", () => {
  for (const outlierMultiple of [-1, Number.NaN, Number.POSITIVE_INFINITY, "3", null, 3n]) {
    assert.throws(() => new ClockSync({ outlierMultiple }), {
      name: "RangeError",
      message: OUTLIER_MULTIPLE_MESSAGE
    });
  }
});

test("push rejects a sample that is not an object", () => {
  const sync = new ClockSync();
  for (const sample of [null, [], "sample", 1, true, false]) {
    assert.throws(() => sync.push(sample), {
      name: "TypeError",
      message: "sample must be an object"
    });
  }
  assert.equal(sync.size, 0);
  assert.equal(sync.offset, null);
});

test("push checks clientSend, then serverTime, then clientReceive", () => {
  const sync = new ClockSync();
  const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "0", null, 1n, true];
  for (const clientSend of bad) {
    assert.throws(() => sync.push({ clientSend, serverTime: Number.NaN, clientReceive: 0 }), {
      name: "RangeError",
      message: CLIENT_SEND_MESSAGE
    });
  }
  for (const serverTime of bad) {
    assert.throws(() => sync.push({ clientSend: 0, serverTime, clientReceive: Number.NaN }), {
      name: "RangeError",
      message: SERVER_STAMP_MESSAGE
    });
  }
  for (const clientReceive of bad) {
    assert.throws(() => sync.push({ clientSend: 0, serverTime: 0, clientReceive }), {
      name: "RangeError",
      message: CLIENT_RECEIVE_MESSAGE
    });
  }
  assert.throws(() => sync.push({ serverTime: 0, clientReceive: 0 }), {
    name: "RangeError",
    message: CLIENT_SEND_MESSAGE
  });
  assert.throws(() => sync.push({ clientSend: 0, clientReceive: 0 }), {
    name: "RangeError",
    message: SERVER_STAMP_MESSAGE
  });
  assert.throws(() => sync.push({ clientSend: 0, serverTime: 0 }), {
    name: "RangeError",
    message: CLIENT_RECEIVE_MESSAGE
  });
  assert.equal(sync.size, 0);
});

test("a receive time before the send time is rejected after the finite checks", () => {
  const sync = new ClockSync();
  assert.throws(() => sync.push({ clientSend: 5, serverTime: Number.NaN, clientReceive: 4 }), {
    name: "RangeError",
    message: SERVER_STAMP_MESSAGE
  });
  assert.throws(() => sync.push(ping(5, 0, 4)), {
    name: "RangeError",
    message: ORDER_MESSAGE
  });
  assert.equal(sync.size, 0);
});

test("inherited sample fields are missing", () => {
  const sync = new ClockSync();
  const sample = Object.create({ clientSend: 0, serverTime: 0, clientReceive: 0 });
  assert.throws(() => sync.push(sample), {
    name: "RangeError",
    message: CLIENT_SEND_MESSAGE
  });
  assert.equal(sync.size, 0);
});

test("a non-finite round-trip time does not change the estimator", () => {
  const sync = new ClockSync();
  sync.push(ping(0, 5, 0));
  const before = snapshot(sync);
  assert.throws(() => sync.push(ping(-Number.MAX_VALUE, 0, Number.MAX_VALUE)), {
    name: "RangeError",
    message: RTT_MESSAGE
  });
  assert.deepEqual(snapshot(sync), before);
});

test("a non-finite midpoint does not change the estimator", () => {
  const sync = new ClockSync();
  sync.push(ping(0, 5, 0));
  const before = snapshot(sync);
  assert.throws(() => sync.push(ping(Number.MAX_VALUE, 0, Number.MAX_VALUE)), {
    name: "RangeError",
    message: MIDPOINT_MESSAGE
  });
  assert.deepEqual(snapshot(sync), before);
});

test("a non-finite sample offset does not change the estimator", () => {
  const sync = new ClockSync();
  sync.push(ping(0, 5, 0));
  const before = snapshot(sync);
  const half = Number.MAX_VALUE / 2;
  assert.throws(() => sync.push(ping(-half, Number.MAX_VALUE, -half)), {
    name: "RangeError",
    message: OFFSET_MESSAGE
  });
  assert.deepEqual(snapshot(sync), before);
});

test("a non-finite spread does not change the estimator", () => {
  const sync = new ClockSync();
  sync.push(ping(0, Number.MAX_VALUE, 0));
  const before = snapshot(sync);
  assert.throws(() => sync.push(ping(0, -Number.MAX_VALUE, 0)), {
    name: "RangeError",
    message: SPREAD_MESSAGE
  });
  assert.deepEqual(snapshot(sync), before);
  assert.equal(sync.serverTime(0), Number.MAX_VALUE);
});

test("serverTime checks the argument before it checks the estimate", () => {
  const sync = new ClockSync();
  for (const localTime of [Number.NaN, Number.POSITIVE_INFINITY, "0", null, 1n, undefined]) {
    assert.throws(() => sync.serverTime(localTime), {
      name: "RangeError",
      message: LOCAL_TIME_MESSAGE
    });
  }
  assert.throws(() => sync.serverTime(10), {
    name: "RangeError",
    message: NO_OFFSET_MESSAGE
  });
  sync.push(ping(0, 5, 0));
  sync.reset();
  assert.throws(() => sync.serverTime(10), {
    name: "RangeError",
    message: NO_OFFSET_MESSAGE
  });
});

test("a non-finite server time does not change the estimator", () => {
  const sync = new ClockSync();
  sync.push(ping(0, Number.MAX_VALUE, 0));
  const before = snapshot(sync);
  assert.throws(() => sync.serverTime(Number.MAX_VALUE), {
    name: "RangeError",
    message: SERVER_TIME_MESSAGE
  });
  assert.deepEqual(snapshot(sync), before);
  assert.equal(sync.serverTime(0), Number.MAX_VALUE);
  assert.equal(sync.serverTime(-1), Number.MAX_VALUE - 1);
});
