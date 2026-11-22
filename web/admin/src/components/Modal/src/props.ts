/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
import { NModal } from 'naive-ui';

export const basicProps = {
  ...NModal.props,
  // 确认按钮文字
  subBtuText: {
    type: String,
    default: '确认',
  },
  showIcon: {
    type: Boolean,
    default: false,
  },
  width: {
    type: Number,
    default: 446,
  },
  title: {
    type: String,
    default: '',
  },
  maskClosable: {
    type: Boolean,
    default: false,
  },
  preset: {
    type: String,
    default: 'dialog',
  },
};
