# @aneron/clock-sync

Estimate a client clock offset and round-trip time from timestamped ping samples.

## Purpose

`@aneron/clock-sync` estimates how far a client clock sits from a server clock. Each sample has three timestamps: the client time when a ping was sent, the server time on the reply, and the client time when the reply arrived. From those it computes a round-trip time and an NTP-style clock offset. It keeps a bounded window of samples, prefers samples with a lower round-trip time, rejects offset outliers inside that low-delay band, and reports the current offset, the round-trip time of the chosen sample, and a spread. `serverTime(localTime)` adds the offset to a local timestamp.

The caller passes every timestamp. The package does not read a clock, start a timer, draw random numbers, open a socket, or touch the filesystem. It has no runtime dependencies.

## Install

The package is an ES module. It needs Node.js 20 or newer.

```bash
npm install @aneron/clock-sync
```

Clone this repository and run the tests:

```bash
git clone https://github.com/ANERON-GAMES/clock-sync.git
cd clock-sync
npm install
npm test
```

`npm test` runs `node --test`. `npm run lint` runs ESLint. `npm run format:check` runs Prettier.

```js
import { ClockSync } from "@aneron/clock-sync";
```

Code in this repository imports the same entry point with `./src/index.js`.

## Usage

Time values below are in one unit chosen by the caller. The class does not treat them as milliseconds.

```js
import { ClockSync } from "@aneron/clock-sync";

const sync = new ClockSync();

const first = sync.push({ clientSend: 100, serverTime: 1105, clientReceive: 110 });
const second = sync.push({ clientSend: 200, serverTime: 1210, clientReceive: 220 });
const slow = sync.push({ clientSend: 300, serverTime: 1600, clientReceive: 500 });

const atTwoHundred = sync.serverTime(200);
```

`first.rtt` is `10`. `first.offset` is `1000`. `first.included` is `true`. `first.spread` is `5`. The offset is `1000`. The round-trip time is `10`. The spread is `5`. `atTwoHundred` is `1200`.

`second.rtt` is `20` and `second.offset` is `1000`. That sample stays inside the low-delay band. The chosen sample is still the one with round-trip time `10`, so `sync.offset` stays `1000` and `sync.spread` stays `5`. `slow.rtt` is `200`. `slow.offset` is `1200`. `slow.included` is `false`. `sync.size` is `3`.

A sample whose offset disagrees with the low-delay cluster is stored and then left out of the estimate:

```js
const stepped = new ClockSync();
stepped.push({ clientSend: 0, serverTime: 50, clientReceive: 10 });
stepped.push({ clientSend: 20, serverTime: 70, clientReceive: 30 });
stepped.push({ clientSend: 40, serverTime: 90, clientReceive: 50 });
const spike = stepped.push({ clientSend: 60, serverTime: 1000, clientReceive: 70 });
const atSeventy = stepped.serverTime(70);
```

`spike.offset` is `935`. `spike.included` is `false`. The offset is `45`. The round-trip time is `10`. The spread is `5`. `stepped.size` is `4`. `atSeventy` is `115`.

The window drops the oldest sample when it is full:

```js
const windowed = new ClockSync({ capacity: 2 });
windowed.push({ clientSend: 0, serverTime: 100, clientReceive: 20 });
windowed.push({ clientSend: 100, serverTime: 205, clientReceive: 110 });
windowed.push({ clientSend: 200, serverTime: 310, clientReceive: 220 });
```

`windowed.size` is `2`. `windowed.samples[0].clientSend` is `100`. The offset is `100`. The round-trip time is `10`. The spread is `5`.

Equal round-trip times select the newer sample:

```js
const ties = new ClockSync({ rttRatio: 1 });
ties.push({ clientSend: 0, serverTime: 15, clientReceive: 10 });
ties.push({ clientSend: 20, serverTime: 40, clientReceive: 30 });
```

The offset is `15`. The round-trip time is `10`. The spread is `10`.

`reset` clears the window:

```js
sync.reset();
```

`sync.offset` is `null`. `sync.rtt` is `null`. `sync.spread` is `null`. `sync.size` is `0`.

## API

### Constants

| Export                     | Value |
| -------------------------- | ----- |
| `MIN_CAPACITY`             | `1`   |
| `MAX_CAPACITY`             | `64`  |
| `DEFAULT_CAPACITY`         | `8`   |
| `DEFAULT_RTT_RATIO`        | `2`   |
| `DEFAULT_OUTLIER_MULTIPLE` | `3`   |
| `OUTLIER_MIN_SAMPLES`      | `3`   |

### `new ClockSync(options)`

Create an estimator. `options` may be omitted. `undefined` uses the same defaults. `options` must be an object and must not be an array. Any other value throws `TypeError` with the message `options must be an object`.

Own fields are read. An omitted field, or a field whose value is `undefined`, uses the default. Unknown fields are ignored. A frozen object and an object with a null prototype are accepted. Inherited fields are ignored.

| Field             | Default | Accepted values                                                      |
| ----------------- | ------- | -------------------------------------------------------------------- |
| `capacity`        | `8`     | An integer from `1` through `64`.                                    |
| `rttRatio`        | `2`     | `Infinity`, or a finite number greater than or equal to `1`.         |
| `outlierMultiple` | `3`     | A finite number greater than or equal to `0`. `-0` is stored as `0`. |

A bad `capacity`, `rttRatio`, or `outlierMultiple` throws `RangeError`. The messages are:

- `capacity must be an integer from 1 to 64`
- `rttRatio must be Infinity or a finite number greater than or equal to 1`
- `outlierMultiple must be a finite number greater than or equal to 0`

Passing `Number.POSITIVE_INFINITY` for `rttRatio` disables the round-trip band and keeps every stored sample eligible for outlier rejection. Before any sample is accepted, `offset`, `rtt`, and `spread` are `null`, and `size` is `0`.

### `sync.push(sample)`

Accept one sample.

`sample` must be an object and must not be an array. Otherwise the method throws `TypeError` with the message `sample must be an object`.

| Field           | Required | Meaning                                                                                                                              |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `clientSend`    | yes      | A finite client timestamp for the moment the ping was sent. `-0` is stored as `0`.                                                   |
| `serverTime`    | yes      | A finite server timestamp from the reply. `-0` is stored as `0`.                                                                     |
| `clientReceive` | yes      | A finite client timestamp for the moment the reply arrived. `-0` is stored as `0`. It must be greater than or equal to `clientSend`. |

Checks run in this order. The first failure wins. A throw leaves the estimator unchanged.

1. `sample` is an object.
2. `clientSend` is a finite number. Otherwise `RangeError`: `clientSend must be a finite number`.
3. `serverTime` is a finite number. Otherwise `RangeError`: `serverTime must be a finite number`.
4. `clientReceive` is a finite number. Otherwise `RangeError`: `clientReceive must be a finite number`.
5. `clientReceive` is greater than or equal to `clientSend`. Otherwise `RangeError`: `clientReceive must be greater than or equal to clientSend`.
6. The round-trip time `clientReceive - clientSend` is finite. Otherwise `RangeError`: `round-trip time must be finite`.
7. The midpoint `(clientSend + clientReceive) / 2` is finite. Otherwise `RangeError`: `sample midpoint must be finite`.
8. The sample offset `serverTime - midpoint` is finite. Otherwise `RangeError`: `sample offset must be finite`.
9. The window, including this sample and without the oldest sample when the window is already at `capacity`, produces a finite spread. Otherwise `RangeError`: `spread must be finite`.

The return value is a plain object:

| Field            | Meaning                                               |
| ---------------- | ----------------------------------------------------- |
| `rtt`            | This sample's round-trip time.                        |
| `offset`         | This sample's offset.                                 |
| `included`       | `true` when this sample is a survivor after the call. |
| `estimateOffset` | `offset` after the call.                              |
| `estimateRtt`    | `rtt` after the call.                                 |
| `spread`         | `spread` after the call.                              |

An accepted sample is stored even when `included` is `false`. `included` reports the survivor set after that call. Later calls do not change a return value already produced. The input object is not mutated. Extra fields are not stored.

### `sync.serverTime(localTime)`

Return `localTime + offset`.

Checks run in this order. The first failure wins. A throw leaves the estimator unchanged.

1. `localTime` is a finite number. Otherwise `RangeError`: `localTime must be a finite number`.
2. A sample has been accepted and `reset` has not cleared it. Otherwise `RangeError`: `no clock offset has been estimated`.
3. The sum is finite. Otherwise `RangeError`: `server time must be finite`.

A sum of zero is returned as `0`.

### Getters

| Getter            | Meaning                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `capacity`        | The configured window length.                                                                   |
| `rttRatio`        | The configured round-trip ratio.                                                                |
| `outlierMultiple` | The configured outlier multiple.                                                                |
| `size`            | The number of stored samples, including samples that are not survivors. At most `capacity`.     |
| `offset`          | The current offset estimate, or `null` when the window is empty.                                |
| `rtt`             | The round-trip time of the chosen survivor, or `null` when the window is empty.                 |
| `spread`          | The current spread, or `null` when the window is empty. A smaller spread is a tighter estimate. |
| `samples`         | A new array of frozen records, oldest first.                                                    |

Each record has `clientSend`, `serverTime`, `clientReceive`, `rtt`, and `offset`. Replacing an element of the array or changing its length does not change the window. Assigning a field on a record throws, because the record is frozen. A later read returns new record objects.

### `sync.reset()`

Drop every stored sample. Set `offset`, `rtt`, and `spread` to `null`. Set `size` to `0`. `capacity`, `rttRatio`, and `outlierMultiple` stay as constructed. Nothing is returned.

### Errors

`TypeError` means `options` or `sample` was not an object.

`RangeError` means a number was missing, not finite, or outside its range, or that a derived round-trip time, midpoint, offset, spread, or server time overflowed. The `message` strings are stable and are listed above. A `RangeError` from `push` or `serverTime` does not change stored samples or the estimate.

## Design

The offset is the standard NTP offset for one server timestamp. With client send time `t0`, server time `t1`, and client receive time `t3`:

```
rtt = t3 - t0
offset = t1 - (t0 + t3) / 2
```

That is the four-timestamp NTP formula with the server receive time and the server send time set to the same stamp. The one-way delay is assumed to be half the round-trip. `offset` is the number added to a client time to estimate the server time. A negative offset means the server clock reads earlier than the client clock. Send and receive times may be negative. The receive time may equal the send time, which is a round-trip of `0`.

Each accepted sample is appended to a queue. When the queue length would exceed `capacity`, the oldest sample is removed first. Removal happens before the estimate is published. A sample that fails a check is not appended, and the previous queue stays as it was. The default capacity is `8`, the same window length as the NTP clock filter. The filter in this package is not the RFC 5905 clock filter. It is the selection below, in real numbers, recomputed from the whole queue after every accepted sample.

Round-trip preference uses the smallest round-trip time in the queue, `bestRtt`. A sample is eligible when `rtt <= bestRtt * rttRatio`. Comparison is exact. There is no epsilon. `rttRatio` of `1` keeps only samples that share that smallest round-trip time. The default `2` also keeps a sample whose round-trip time is at most twice the best. `Infinity` keeps every stored sample. If `bestRtt * rttRatio` is not finite, every stored sample is eligible. Eligible samples are ordered by ascending round-trip time. Equal round-trip times are ordered newest first.

Outlier rejection runs only when at least `OUTLIER_MIN_SAMPLES` samples are eligible. That constant is `3`. The median of their offsets is the middle value when the count is odd, and the mean of the two middle values when the count is even, after sorting the offsets ascending. The median absolute deviation is that same median applied to the absolute differences from the median. A sample is rejected when its absolute difference from the median is strictly greater than `outlierMultiple` times that deviation. A difference equal to the limit is kept. When the limit is `0`, only an eligible offset equal to the median is kept. If the median, the median absolute deviation, or the product is not finite, no sample is rejected in this step. If the step would reject every eligible sample, it is skipped and every eligible sample stays.

The survivors keep the eligible order. The first survivor is the chosen sample. `offset` is that sample's offset. `rtt` is that sample's round-trip time. The estimate is not the mean of the survivors and it is not the median. The median is only the center used to reject outliers.

The spread is:

```
spread = chosenRtt / 2 + max(abs(survivorOffset - chosenOffset))
```

`chosenRtt / 2` is the largest error that delay asymmetry can hide in the chosen sample, because one direction can hold the whole round trip. The second term is the largest absolute disagreement between the chosen offset and any other survivor. With one survivor the second term is `0`, so the spread is half the chosen round-trip time.

Samples that fail the round-trip test or the outlier test remain in the queue until they age out. A later sample can put them back into the eligible set. A clock step shows up as a run of new offsets. While those new offsets are still too few to move the median absolute deviation, the old offsets can stay in the estimate. Once the new offsets dominate the eligible set, the old offsets become the outliers, and the estimate moves to the new clock before every old sample has left the queue. `reset` drops the queue immediately.

With `capacity` of `4` and equal round-trip times, three offsets of `0` and one offset of `50` keep the estimate at `0`, because the `50` is outside a median absolute deviation of `0`. One offset of `0` and three offsets of `50` move the estimate to `50` and reject the remaining `0`. The stored `size` is still `4`.

Two `ClockSync` instances do not share samples or estimates. The same sequence of samples produces the same offsets, round-trip times, spreads, and `serverTime` results. `push`, `serverTime`, and `reset` do not read `Date`, a monotonic clock, a timer, or a random source.

## License

MIT. Copyright (c) 2026 Vadim Gubin. See [LICENSE](LICENSE).
