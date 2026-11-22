/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
import { computed } from 'vue';
import { useDesignSettingStore } from '@/store/modules/designSetting';

export function useDesignSetting() {
  const designStore = useDesignSettingStore();

  const getDarkTheme = computed(() => designStore.darkTheme);

  const getAppTheme = computed(() => designStore.appTheme);

  const getAppThemeList = computed(() => designStore.appThemeList);

  return {
    getDarkTheme,
    getAppTheme,
    getAppThemeList,
  };
}
