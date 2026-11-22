/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
import { IAsyncRouteState } from '@/store/modules/asyncRoute';
import { IUserState } from '@/store/modules/user';
import { IScreenLockState } from '@/store/modules/screenLock';
import { ITabsViewState } from '@/store/modules/tabsView';

export interface IStore {
  asyncRoute: IAsyncRouteState;
  user: IUserState;
  screenLock: IScreenLockState;
  tabsView: ITabsViewState;
  count: number;
}
