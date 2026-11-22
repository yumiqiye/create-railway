/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
import { renderIcon } from '@/utils/index';
import {
  DashboardOutlined,
  TableOutlined,
  ApartmentOutlined,
  EnvironmentOutlined,
  ProfileOutlined,
  TagsOutlined,
  SettingOutlined,
  InfoCircleOutlined,
} from '@vicons/antd';

// 前端路由图标映射表（后端菜单 meta.icon 通过此表解析）
export const constantRouterIcon = {
  DashboardOutlined: renderIcon(DashboardOutlined),
  TableOutlined: renderIcon(TableOutlined),
  ApartmentOutlined: renderIcon(ApartmentOutlined),
  EnvironmentOutlined: renderIcon(EnvironmentOutlined),
  ProfileOutlined: renderIcon(ProfileOutlined),
  TagsOutlined: renderIcon(TagsOutlined),
  SettingOutlined: renderIcon(SettingOutlined),
  InfoCircleOutlined: renderIcon(InfoCircleOutlined),
};
