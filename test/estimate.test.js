import assert from "node:assert/strict";
import test from "node:test";
import { ClockSync } from "../src/index.js";
import { at, ping, snapshot } from "./helpers.js";

function assertPublished(sync, result) {
  assert.equal(result.estimateOffset, sync.offset);
  assert.equal(result.estimateRtt, sync.rtt);
  assert.equal(result.spread, sync.spread);
}

test("one symmetric sample reports offset, half the round trip, and server time", () => {
  const sync = new ClockSync();
  const sample = ping(100, 1105, 110);
  const first = sync.push(sample);
  assert.equal(sample.clientSend, 100);
  assert.equal(first.rtt, 10);
  assert.equal(first.offset, 1000);
  assert.equal(first.included, true);
  assert.equal(first.spread, 5);
  assertPublished(sync, first);
  assert.equal(sync.offset, 1000);
  assert.equal(sync.rtt, 10);
  assert.equal(sync.spread, 5);
  assert.equal(sync.size, 1);
  assert.equal(sync.serverTime(200), 1200);
  assert.deepEqual(sync.samples, [
    {
      clientSend: 100,
      serverTime: 1105,
      clientReceive: 110,
      rtt: 10,
      offset: 1000
    }
  ]);
});

test("a negative offset subtracts from local time", () => {
  const sync = new ClockSync();
  const result = sync.push(ping(100, 40, 110));
  assert.equal(result.rtt, 10);
  assert.equal(result.offset, -65);
  assert.equal(sync.spread, 5);
  assert.equal(sync.serverTime(100), 35);
});

test("a zero round trip has a spread of zero", () => {
  const sync = new ClockSync();
  const result = sync.push(ping(5, 8, 5));
  assert.equal(result.rtt, 0);
  assert.equal(result.offset, 3);
  assert.equal(Object.is(sync.spread, 0), true);
  assert.equal(sync.serverTime(5), 8);
});

test("negative zero timestamps are stored as zero", () => {
  const sync = new ClockSync();
  const result = sync.push({ clientSend: -0, serverTime: -0, clientReceive: -0 });
  assert.equal(Object.is(result.rtt, 0), true);
  assert.equal(Object.is(result.offset, 0), true);
  assert.equal(Object.is(sync.offset, 0), true);
  assert.equal(Object.is(sync.rtt, 0), true);
  assert.equal(Object.is(sync.spread, 0), true);
  assert.equal(Object.is(sync.serverTime(-0), 0), true);
  const stored = sync.samples[0];
  assert.equal(Object.is(stored.clientSend, 0), true);
  assert.equal(Object.is(stored.serverTime, 0), true);
  assert.equal(Object.is(stored.clientReceive, 0), true);
});

test("the usage window keeps the low round trip and drops the slow sample from the estimate", () => {
  const sync = new ClockSync();
  const first = sync.push(ping(100, 1105, 110));
  const second = sync.push(ping(200, 1210, 220));
  const slow = sync.push(ping(300, 1600, 500));
  assert.equal(first.included, true);
  assert.equal(second.rtt, 20);
  assert.equal(second.offset, 1000);
  assert.equal(second.included, true);
  assert.equal(slow.rtt, 200);
  assert.equal(slow.offset, 1200);
  assert.equal(slow.included, false);
  assert.equal(sync.offset, 1000);
  assert.equal(sync.rtt, 10);
  assert.equal(sync.spread, 5);
  assert.equal(sync.size, 3);
  assert.equal(sync.serverTime(200), 1200);
});

test("a frozen sample and a null-prototype sample are accepted without copying extra fields", () => {
  const sync = new ClockSync();
  const frozen = Object.freeze({ clientSend: 1, serverTime: 4, clientReceive: 3, note: "keep" });
  sync.push(frozen);
  assert.equal(frozen.note, "keep");
  const bare = Object.create(null);
  bare.clientSend = 10;
  bare.serverTime = 16;
  bare.clientReceive = 12;
  bare.extra = true;
  sync.push(bare);
  assert.deepEqual(sync.samples[0], {
    clientSend: 1,
    serverTime: 4,
    clientReceive: 3,
    rtt: 2,
    offset: 2
  });
  assert.equal(Object.hasOwn(sync.samples[1], "extra"), false);
});

test("sample reads return new frozen records and do not share the queue", () => {
  const sync = new ClockSync();
  sync.push(ping(1, 2, 3));
  const first = sync.samples;
  const second = sync.samples;
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first[0]), true);
  assert.throws(() => {
    first[0].offset = 9;
  }, TypeError);
  first.pop();
  first.push({ clientSend: 0, serverTime: 0, clientReceive: 0, rtt: 0, offset: 0 });
  assert.equal(sync.size, 1);
  assert.equal(sync.samples[0].clientSend, 1);
  assert.equal(sync.offset, 0);
});

test("serverTime does not change the estimate", () => {
  const sync = new ClockSync();
  sync.push(ping(0, 10.25, 1));
  const before = snapshot(sync);
  assert.equal(sync.offset, 9.75);
  assert.equal(sync.spread, 0.5);
  assert.equal(sync.serverTime(10.25), 20);
  assert.deepEqual(snapshot(sync), before);
});

test("reset clears samples and keeps the configured bounds", () => {
  const sync = new ClockSync({ capacity: 4, rttRatio: 5, outlierMultiple: 1 });
  sync.push(ping(100, 1105, 110));
  sync.serverTime(1);
  const cleared = sync.reset();
  assert.equal(cleared, undefined);
  assert.equal(sync.capacity, 4);
  assert.equal(sync.rttRatio, 5);
  assert.equal(sync.outlierMultiple, 1);
  assert.equal(sync.offset, null);
  assert.equal(sync.rtt, null);
  assert.equal(sync.spread, null);
  assert.equal(sync.size, 0);
  assert.deepEqual(sync.samples, []);
  const again = sync.push(ping(0, 4, 2));
  assert.equal(again.offset, 3);
  assert.equal(sync.serverTime(1), 4);
});

test("instances do not share state", () => {
  const left = new ClockSync();
  const right = new ClockSync();
  left.push(ping(100, 1105, 110));
  assert.equal(right.offset, null);
  assert.equal(right.size, 0);
  right.push(ping(0, 1, 2));
  assert.equal(left.offset, 1000);
  assert.equal(left.size, 1);
  assert.equal(right.offset, 0);
});

test("the same samples produce the same estimate", () => {
  const pings = [];
  for (let index = 0; index < 20; index += 1) {
    const clientSend = index * 50;
    const rtt = 10 + (index % 5) * 3;
    const clientReceive = clientSend + rtt;
    const serverTime = clientSend + 1000 + rtt / 2 + (index % 7);
    pings.push({ clientSend, serverTime, clientReceive });
  }
  const first = new ClockSync({ capacity: 5, rttRatio: 1.5, outlierMultiple: 2 });
  const second = new ClockSync({ capacity: 5, rttRatio: 1.5, outlierMultiple: 2 });
  for (const sample of pings) {
    first.push(sample);
  }
  for (const sample of pings) {
    second.push(sample);
  }
  assert.deepEqual(snapshot(first), snapshot(second));
  assert.equal(first.serverTime(40), second.serverTime(40));
  const tail = new ClockSync({ capacity: 5, rttRatio: 1.5, outlierMultiple: 2 });
  for (const sample of pings) {
    tail.push(sample);
  }
  tail.reset();
  const fresh = new ClockSync({ capacity: 5, rttRatio: 1.5, outlierMultiple: 2 });
  for (const sample of pings.slice(12)) {
    tail.push(sample);
    fresh.push(sample);
  }
  assert.deepEqual(snapshot(tail), snapshot(fresh));
});

test("requested offsets round-trip through the stored sample", () => {
  const sync = new ClockSync();
  sync.push(at(0, 4, 6));
  sync.push(at(20, -2, 0));
  assert.equal(sync.samples[0].offset, 4);
  assert.equal(sync.samples[0].rtt, 6);
  assert.equal(sync.samples[1].offset, -2);
  assert.equal(sync.samples[1].rtt, 0);
  assert.equal(sync.samples[1].clientSend, 20);
  assert.equal(sync.samples[1].clientReceive, 20);
});
