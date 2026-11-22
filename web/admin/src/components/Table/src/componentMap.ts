/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
import type { Component } from 'vue';
import {
  NInput,
  NSelect,
  NCheckbox,
  NInputNumber,
  NSwitch,
  NDatePicker,
  NTimePicker,
} from 'naive-ui';
import type { ComponentType } from './types/componentType';

export const EventEnum = {
  NInput: 'on-input',
  NInputNumber: 'on-input',
  NSelect: 'on-update:value',
  NSwitch: 'on-update:value',
  NCheckbox: 'on-update:value',
  NDatePicker: 'on-update:value',
  NTimePicker: 'on-update:value',
} as const;

const componentMap = new Map<ComponentType, Component>();

componentMap.set('NInput', NInput);
componentMap.set('NInputNumber', NInputNumber);
componentMap.set('NSelect', NSelect);
componentMap.set('NSwitch', NSwitch);
componentMap.set('NCheckbox', NCheckbox);
componentMap.set('NDatePicker', NDatePicker);
componentMap.set('NTimePicker', NTimePicker);

export function add(compName: ComponentType, component: Component) {
  componentMap.set(compName, component);
}

export function del(compName: ComponentType) {
  componentMap.delete(compName);
}

export { componentMap };
