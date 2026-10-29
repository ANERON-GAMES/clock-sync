import assert from "node:assert/strict";
import test from "node:test";
import { ClockSync } from "../src/index.js";
import { at, ping } from "./helpers.js";

test("the disagreeing sample from the usage example is stored and excluded", () => {
  const stepped = new ClockSync();
  stepped.push(ping(0, 50, 10));
  stepped.push(ping(20, 70, 30));
  stepped.push(ping(40, 90, 50));
  const spike = stepped.push(ping(60, 1000, 70));
  assert.equal(spike.offset, 935);
  assert.equal(spike.rtt, 10);
  assert.equal(spike.included, false);
  assert.equal(stepped.offset, 45);
  assert.equal(stepped.rtt, 10);
  assert.equal(stepped.spread, 5);
  assert.equal(stepped.size, 4);
  assert.equal(stepped.serverTime(70), 115);
  assert.equal(stepped.samples[3].offset, 935);
  assert.equal(stepped.samples[2].offset, 45);
});

test("a full window drops the oldest sample", () => {
  const windowed = new ClockSync({ capacity: 2 });
  windowed.push(ping(0, 100, 20));
  const second = windowed.push(ping(100, 205, 110));
  assert.equal(second.offset, 100);
  assert.equal(windowed.offset, 100);
  assert.equal(windowed.spread, 15);
  windowed.push(ping(200, 310, 220));
  assert.equal(windowed.size, 2);
  assert.equal(windowed.samples[0].clientSend, 100);
  assert.equal(windowed.samples[1].clientSend, 200);
  assert.equal(windowed.offset, 100);
  assert.equal(windowed.rtt, 10);
  assert.equal(windowed.spread, 5);
});

test("capacity one replaces the only sample", () => {
  const sync = new ClockSync({ capacity: 1 });
  sync.push(ping(0, 5, 2));
  const next = sync.push(ping(10, 40, 16));
  assert.equal(next.included, true);
  assert.equal(sync.size, 1);
  assert.equal(sync.offset, 27);
  assert.equal(sync.rtt, 6);
  assert.equal(sync.spread, 3);
  assert.equal(sync.samples[0].clientSend, 10);
});

test("the default window keeps the eight newest samples", () => {
  const sync = new ClockSync();
  for (let index = 0; index < 9; index += 1) {
    sync.push({
      clientSend: index,
      serverTime: index + 5,
      clientReceive: index
    });
  }
  assert.equal(sync.size, 8);
  assert.equal(sync.capacity, 8);
  assert.equal(sync.samples[0].clientSend, 1);
  assert.equal(sync.samples[7].clientSend, 8);
  assert.equal(sync.offset, 5);
  assert.equal(Object.is(sync.rtt, 0), true);
  assert.equal(Object.is(sync.spread, 0), true);
  assert.equal(sync.serverTime(10), 15);
});

test("equal round-trip times choose the newer sample and add the disagreement", () => {
  const ties = new ClockSync({ rttRatio: 1 });
  ties.push(ping(0, 15, 10));
  const second = ties.push(ping(20, 40, 30));
  assert.equal(second.included, true);
  assert.equal(ties.offset, 15);
  assert.equal(ties.rtt, 10);
  assert.equal(ties.spread, 10);
});

test("a round trip equal to the ratio limit stays eligible and the next integer does not", () => {
  const sync = new ClockSync({ rttRatio: 2 });
  sync.push(ping(0, 15, 10));
  const edge = sync.push(ping(100, 130, 120));
  const past = sync.push(ping(200, 240.5, 221));
  assert.equal(edge.rtt, 20);
  assert.equal(edge.offset, 20);
  assert.equal(edge.included, true);
  assert.equal(past.rtt, 21);
  assert.equal(past.offset, 30);
  assert.equal(past.included, false);
  assert.equal(sync.offset, 10);
  assert.equal(sync.rtt, 10);
  assert.equal(sync.spread, 15);
  assert.equal(sync.size, 3);
});

test("a lower round trip replaces the chosen sample and ignores the previous band", () => {
  const sync = new ClockSync();
  sync.push(ping(0, 15, 10));
  sync.push(ping(100, 130, 120));
  const better = sync.push(ping(200, 206, 204));
  assert.equal(better.rtt, 4);
  assert.equal(better.offset, 4);
  assert.equal(better.included, true);
  assert.equal(sync.offset, 4);
  assert.equal(sync.rtt, 4);
  assert.equal(sync.spread, 2);
  assert.equal(sync.size, 3);
});

test("Infinity and a non-finite ratio product keep a slow sample in the spread", () => {
  const open = new ClockSync({ rttRatio: Number.POSITIVE_INFINITY });
  open.push(ping(0, 11, 2));
  open.push(ping(10, 100, 30));
  assert.equal(open.offset, 10);
  assert.equal(open.rtt, 2);
  assert.equal(open.spread, 71);

  const wide = new ClockSync({ rttRatio: Number.MAX_VALUE });
  wide.push(ping(0, 11, 2));
  wide.push(ping(10, 100, 30));
  assert.equal(wide.offset, 10);
  assert.equal(wide.rtt, 2);
  assert.equal(wide.spread, 71);
});

test("a lone low round trip is not voted down by slower samples", () => {
  const sync = new ClockSync();
  const low = sync.push(at(0, 500, 10));
  sync.push(at(20, 0, 100));
  sync.push(at(40, 0, 100));
  sync.push(at(60, 0, 100));
  assert.equal(low.included, true);
  assert.equal(sync.offset, 500);
  assert.equal(sync.rtt, 10);
  assert.equal(sync.spread, 5);
  assert.equal(sync.size, 4);
});

test("raising the ratio lets the slower cluster reject the lone low round trip", () => {
  const sync = new ClockSync({ rttRatio: Number.POSITIVE_INFINITY });
  const low = sync.push(at(0, 500, 10));
  sync.push(at(20, 0, 100));
  sync.push(at(40, 0, 100));
  const last = sync.push(at(60, 0, 100));
  assert.equal(low.included, true);
  assert.equal(last.included, true);
  assert.equal(sync.offset, 0);
  assert.equal(sync.rtt, 100);
  assert.equal(sync.spread, 50);
  assert.equal(sync.samples[0].offset, 500);
});

test("two samples do not reject an offset outlier", () => {
  const sync = new ClockSync();
  sync.push(at(0, 1, 8));
  const wild = sync.push(at(20, 50, 8));
  assert.equal(wild.included, true);
  assert.equal(sync.offset, 50);
  assert.equal(sync.rtt, 8);
  assert.equal(sync.spread, 53);
});

test("a third agreeing sample rejects the earlier outlier without changing its old result", () => {
  const sync = new ClockSync();
  sync.push(at(0, 1, 8));
  const wild = sync.push(at(20, 50, 8));
  const third = sync.push(at(40, 1, 8));
  assert.equal(wild.included, true);
  assert.equal(third.included, true);
  assert.equal(third.offset, 1);
  assert.equal(sync.offset, 1);
  assert.equal(sync.rtt, 8);
  assert.equal(sync.spread, 4);
  assert.equal(sync.size, 3);
  assert.equal(sync.samples[1].offset, 50);
});

test("the newest equal round trip is skipped when it is the outlier", () => {
  const sync = new ClockSync();
  sync.push(at(0, 45));
  sync.push(at(100, 46));
  sync.push(at(200, 47));
  const spike = sync.push(at(300, 935));
  assert.equal(spike.included, false);
  assert.equal(sync.offset, 47);
  assert.equal(sync.rtt, 10);
  assert.equal(sync.spread, 7);
  assert.equal(sync.samples.map((sample) => sample.offset).join(","), "45,46,47,935");
});

test("an offset on the median absolute deviation limit is kept and the next step is not", () => {
  const kept = new ClockSync();
  kept.push(at(0, 0));
  kept.push(at(100, 10));
  kept.push(at(200, 20));
  const edge = kept.push(at(300, 45));
  assert.equal(edge.included, true);
  assert.equal(kept.offset, 45);
  assert.equal(kept.spread, 50);

  const dropped = new ClockSync();
  dropped.push(at(0, 0));
  dropped.push(at(100, 10));
  dropped.push(at(200, 20));
  const past = dropped.push(at(300, 46));
  assert.equal(past.included, false);
  assert.equal(dropped.offset, 20);
  assert.equal(dropped.rtt, 10);
  assert.equal(dropped.spread, 25);
});

test("a multiple below one keeps every sample when rejection would empty the band", () => {
  const sync = new ClockSync({ outlierMultiple: 0.5 });
  sync.push(at(0, 0));
  sync.push(at(10, 0));
  sync.push(at(20, 10));
  const last = sync.push(at(30, 10));
  assert.equal(last.included, true);
  assert.equal(sync.offset, 10);
  assert.equal(sync.rtt, 10);
  assert.equal(sync.spread, 15);
  assert.equal(sync.size, 4);
});

test("a zero multiple keeps only offsets equal to the median", () => {
  const sync = new ClockSync({ outlierMultiple: 0, rttRatio: Number.POSITIVE_INFINITY });
  sync.push(ping(0, 5, 0));
  sync.push(ping(10, 15, 10));
  const last = sync.push(ping(20, 30, 20));
  assert.equal(last.offset, 10);
  assert.equal(last.included, false);
  assert.equal(sync.offset, 5);
  assert.equal(Object.is(sync.rtt, 0), true);
  assert.equal(Object.is(sync.spread, 0), true);
});

test("a new majority takes the estimate before the old samples leave the window", () => {
  const sync = new ClockSync({ capacity: 4 });
  sync.push(at(0, 0));
  sync.push(at(10, 0));
  sync.push(at(20, 0));
  const early = sync.push(at(30, 50));
  assert.equal(early.included, false);
  assert.equal(sync.offset, 0);
  assert.equal(Object.is(sync.spread, 5), true);
  sync.push(at(40, 50));
  const moved = sync.push(at(50, 50));
  assert.equal(moved.included, true);
  assert.equal(sync.size, 4);
  assert.equal(sync.offset, 50);
  assert.equal(sync.rtt, 10);
  assert.equal(sync.spread, 5);
  assert.deepEqual(
    sync.samples.map((sample) => sample.offset),
    [0, 50, 50, 50]
  );
});
