/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
import { ref, onMounted, onUnmounted } from 'vue';
import { debounce } from 'lodash-es';

/**
 * description: 获取页面宽度
 */

export function useDomWidth() {
  const domWidth = ref(window.innerWidth);

  function resize() {
    domWidth.value = document.body.clientWidth;
  }

  onMounted(() => {
    window.addEventListener('resize', debounce(resize, 80));
  });
  onUnmounted(() => {
    window.removeEventListener('resize', resize);
  });

  return domWidth;
}
