/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
import { provide, inject } from 'vue';

const key = Symbol('formElRef');

export function createFormContext(instance) {
  provide(key, instance);
}

export function useFormContext() {
  return inject(key);
}
