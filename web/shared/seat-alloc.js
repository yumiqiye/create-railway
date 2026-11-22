/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
/**
 * 座位分配与位图存储
 * 用 Uint8Array 位图记录每趟车/日期/席别的座位占用情况，避免为每个座位建对象。
 * 同单乘客优先分配同一排连续座位，尽量坐在一起。
 */

const LAYOUTS = {
  商务座: { letters: ['A', 'C', 'F'], rowsPerCar: 8 },
  一等座: { letters: ['A', 'C', 'D', 'F'], rowsPerCar: 13 },
  二等座: { letters: ['A', 'B', 'C', 'D', 'F'], rowsPerCar: 20 },
  无座: { letters: ['A'], rowsPerCar: 100 },
};

class SeatBitmap {
  constructor(capacity, base64) {
    this.capacity = Math.max(0, Number(capacity) || 0);
    this.bytes = Math.ceil(this.capacity / 8);
    this.data = new Uint8Array(this.bytes);
    if (base64) {
      try {
        const raw = Buffer.from(String(base64), 'base64');
        for (let i = 0; i < Math.min(raw.length, this.bytes); i += 1) this.data[i] = raw[i];
      } catch (e) {
        /* 损坏的位图按全空处理 */
      }
    }
  }

  has(index) {
    if (index < 0 || index >= this.capacity) return true;
    return (this.data[Math.floor(index / 8)] & (1 << (index % 8))) !== 0;
  }

  set(index) {
    if (index < 0 || index >= this.capacity) return;
    this.data[Math.floor(index / 8)] |= 1 << (index % 8);
  }

  clear(index) {
    if (index < 0 || index >= this.capacity) return;
    this.data[Math.floor(index / 8)] &= ~(1 << (index % 8));
  }

  count() {
    let total = 0;
    for (let i = 0; i < this.capacity; i += 1) if (this.has(i)) total += 1;
    return total;
  }

  toBase64() {
    return Buffer.from(this.data).toString('base64');
  }
}

function layoutOf(seatType) {
  return LAYOUTS[seatType] || LAYOUTS['二等座'];
}

function labelOf(seatType, index) {
  const layout = layoutOf(seatType);
  const perCar = layout.letters.length * layout.rowsPerCar;
  const car = Math.floor(index / perCar) + 1;
  const inCar = index % perCar;
  const row = Math.floor(inCar / layout.letters.length) + 1;
  const letter = layout.letters[inCar % layout.letters.length];
  return String(car).padStart(2, '0') + '车' + String(row).padStart(2, '0') + letter;
}

/**
 * 返回 { seats: [{index,label}], bitmap }
 * 优先同一排连续空位；不足时按同车厢连续空位兜底。
 */
function allocateSeats(seatType, capacity, bitmap, count) {
  const layout = layoutOf(seatType);
  const perRow = layout.letters.length;
  const total = Math.max(0, Number(capacity) || 0);
  const want = Math.max(0, Number(count) || 0);
  const picked = [];
  if (!want) return { seats: [], bitmap };

  // 1. 同一排连续空位，保证同行旅客坐一起
  if (want <= perRow) {
    for (let start = 0; start < total; start += perRow) {
      const slots = [];
      for (let i = 0; i < perRow; i += 1) {
        const index = start + i;
        if (index < total && !bitmap.has(index)) slots.push(index);
      }
      for (let offset = 0; offset + want <= slots.length; offset += 1) {
        const candidate = slots.slice(offset, offset + want);
        const contiguous = candidate.every((idx, i) => i === 0 || idx === candidate[i - 1] + 1);
        if (contiguous) {
          for (const index of candidate) {
            bitmap.set(index);
            picked.push({ index, label: labelOf(seatType, index) });
          }
          return { seats: picked, bitmap };
        }
      }
    }
  }

  // 2. 同车厢连续空位
  const perCar = layout.letters.length * layout.rowsPerCar;
  for (let carStart = 0; carStart < total; carStart += perCar) {
    const end = Math.min(total, carStart + perCar);
    let runStart = -1;
    for (let index = carStart; index <= end; index += 1) {
      const free = index < end && !bitmap.has(index);
      if (free && runStart < 0) runStart = index;
      if (!free && runStart >= 0) {
        if (index - runStart >= want) {
          for (let i = 0; i < want; i += 1) {
            const seatIndex = runStart + i;
            bitmap.set(seatIndex);
            picked.push({ index: seatIndex, label: labelOf(seatType, seatIndex) });
          }
          return { seats: picked, bitmap };
        }
        runStart = -1;
      }
    }
  }

  // 3. 全车散座兜底
  for (let index = 0; index < total && picked.length < want; index += 1) {
    if (!bitmap.has(index)) {
      bitmap.set(index);
      picked.push({ index, label: labelOf(seatType, index) });
    }
  }
  return { seats: picked, bitmap };
}

function bitmapFromOrders(orders, trainId, date, seatType, capacity) {
  const bitmap = new SeatBitmap(capacity);
  (orders || []).forEach((order) => {
    if (order.trainId !== trainId || order.date !== date || order.seatType !== seatType) return;
    if (order.seatHolding === false) return;
    if (order.status !== 'paid' && order.status !== 'pending') return;
    (order.passengers || []).forEach((p) => {
      if (Number.isInteger(p.seatIndex)) bitmap.set(p.seatIndex);
    });
  });
  return bitmap;
}

module.exports = { SeatBitmap, allocateSeats, bitmapFromOrders, labelOf, layoutOf };
