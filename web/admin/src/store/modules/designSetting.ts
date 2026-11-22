/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
import { defineStore } from 'pinia';
import { store } from '@/store';
import designSetting from '@/settings/designSetting';

const { darkTheme, appTheme, appThemeList } = designSetting;

interface DesignSettingState {
  //深色主题
  darkTheme: boolean;
  //系统风格
  appTheme: string;
  //系统内置风格
  appThemeList: string[];
}

export const useDesignSettingStore = defineStore({
  id: 'app-design-setting',
  state: (): DesignSettingState => ({
    darkTheme,
    appTheme,
    appThemeList,
  }),
  getters: {
    getDarkTheme(): boolean {
      return this.darkTheme;
    },
    getAppTheme(): string {
      return this.appTheme;
    },
    getAppThemeList(): string[] {
      return this.appThemeList;
    },
  },
  actions: {},
});

// Need to be used outside the setup
export function useDesignSetting() {
  return useDesignSettingStore(store);
}
