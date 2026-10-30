export function ping(clientSend, serverTime, clientReceive) {
  return { clientSend, serverTime, clientReceive };
}

export function at(clientSend, offset, rtt = 10) {
  const clientReceive = clientSend + rtt;
  const serverTime = offset + (clientSend + clientReceive) / 2;
  return { clientSend, serverTime, clientReceive };
}

export function snapshot(sync) {
  return {
    capacity: sync.capacity,
    rttRatio: sync.rttRatio,
    outlierMultiple: sync.outlierMultiple,
    size: sync.size,
    offset: sync.offset,
    rtt: sync.rtt,
    spread: sync.spread,
    samples: sync.samples
  };
}
