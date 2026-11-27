/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
import { RouteRecordRaw } from 'vue-router';
import { Layout } from '@/router/constant';
import {
  DashboardOutlined,
  ApartmentOutlined,
  EnvironmentOutlined,
  TableOutlined,
  TagsOutlined,
  SafetyOutlined,
  SettingOutlined,
  ProfileOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  FileAddOutlined,
  ShoppingCartOutlined,
  BellOutlined,
  BarChartOutlined,
} from '@vicons/antd';
import { renderIcon } from '@/utils/index';

/**
 * 清江铁路12306 后台菜单
 * 顺序：总览 → 城市 → 车站 → 车次 → 车票 → 售票窗口 → 补票 → 检票 → 订单 → 发票 → 系统设置 → 日志 → 关于
 */
const routes: Array<RouteRecordRaw> = [
  {
    path: '/overview',
    name: 'OverviewRoot',
    redirect: '/overview/index',
    component: Layout,
    meta: { title: '总览', icon: renderIcon(DashboardOutlined), sort: 1, permissions: ['ticket_overview'] },
    children: [
      {
        path: 'index',
        name: 'ticket_overview',
        meta: { title: '总览' },
        component: () => import('@/views/ticket/overview/index.vue'),
      },
    ],
  },
  {
    path: '/reports',
    name: 'ReportsRoot',
    redirect: '/reports/index',
    component: Layout,
    meta: { title: '运营报表', icon: renderIcon(BarChartOutlined), sort: 1.5, permissions: ['ticket_reports'] },
    children: [
      {
        path: 'index',
        name: 'ticket_reports',
        meta: { title: '运营报表' },
        component: () => import('@/views/ticket/reports/index.vue'),
      },
    ],
  },
  {
    path: '/cities',
    name: 'CitiesRoot',
    redirect: '/cities/index',
    component: Layout,
    meta: { title: '城市管理', icon: renderIcon(ApartmentOutlined), sort: 2, permissions: ['ticket_cities'] },
    children: [
      {
        path: 'index',
        name: 'ticket_cities',
        meta: { title: '城市管理' },
        component: () => import('@/views/ticket/cities/index.vue'),
      },
    ],
  },
  {
    path: '/stations',
    name: 'StationsRoot',
    redirect: '/stations/index',
    component: Layout,
    meta: { title: '车站管理', icon: renderIcon(EnvironmentOutlined), sort: 3, permissions: ['ticket_stations'] },
    children: [
      {
        path: 'index',
        name: 'ticket_stations',
        meta: { title: '车站管理' },
        component: () => import('@/views/ticket/stations/index.vue'),
      },
    ],
  },
  {
    path: '/trains',
    name: 'TrainsRoot',
    redirect: '/trains/index',
    component: Layout,
    meta: { title: '车次管理', icon: renderIcon(TableOutlined), sort: 4, permissions: ['ticket_trains'] },
    children: [
      {
        path: 'index',
        name: 'ticket_trains',
        meta: { title: '车次管理' },
        component: () => import('@/views/ticket/trains/index.vue'),
      },
    ],
  },
  {
    path: '/fares',
    name: 'FaresRoot',
    redirect: '/fares/index',
    component: Layout,
    meta: { title: '票价管理', icon: renderIcon(TagsOutlined), sort: 4.5, permissions: ['ticket_fares'] },
    children: [
      {
        path: 'index',
        name: 'ticket_fares',
        meta: { title: '票价管理' },
        component: () => import('@/views/ticket/fares/index.vue'),
      },
    ],
  },
  {
    path: '/bureaus',
    name: 'BureausRoot',
    redirect: '/bureaus/index',
    component: Layout,
    meta: { title: '铁路局管理', icon: renderIcon(ApartmentOutlined), sort: 4.6, permissions: ['ticket_bureaus'] },
    children: [
      {
        path: 'index',
        name: 'ticket_bureaus',
        meta: { title: '铁路局管理' },
        component: () => import('@/views/ticket/bureaus/index.vue'),
      },
    ],
  },
  {
    path: '/tickets',
    name: 'TicketsRoot',
    redirect: '/tickets/index',
    component: Layout,
    meta: { title: '车票管理', icon: renderIcon(TagsOutlined), sort: 5, permissions: ['ticket_tickets'] },
    children: [
      {
        path: 'index',
        name: 'ticket_tickets',
        meta: { title: '车票管理' },
        component: () => import('@/views/ticket/tickets/index.vue'),
      },
    ],
  },
  {
    path: '/sales',
    name: 'SalesRoot',
    redirect: '/sales/index',
    component: Layout,
    meta: { title: '售票窗口', icon: renderIcon(ShoppingCartOutlined), sort: 6, permissions: ['ticket_sales'] },
    children: [
      {
        path: 'index',
        name: 'ticket_sales',
        meta: { title: '售票窗口' },
        component: () => import('@/views/ticket/sales/index.vue'),
      },
    ],
  },
  {
    path: '/supplement',
    name: 'SupplementRoot',
    redirect: '/supplement/index',
    component: Layout,
    meta: { title: '补票管理', icon: renderIcon(FileAddOutlined), sort: 7, permissions: ['ticket_supplement'] },
    children: [
      {
        path: 'index',
        name: 'ticket_supplement',
        meta: { title: '补票管理' },
        component: () => import('@/views/ticket/supplement/index.vue'),
      },
    ],
  },
  {
    path: '/checkin',
    name: 'CheckinRoot',
    redirect: '/checkin/index',
    component: Layout,
    meta: { title: '检票管理', icon: renderIcon(SafetyOutlined), sort: 8, permissions: ['ticket_checkin'] },
    children: [
      {
        path: 'index',
        name: 'ticket_checkin',
        meta: { title: '检票管理' },
        component: () => import('@/views/ticket/checkin/index.vue'),
      },
    ],
  },
  {
    path: '/tvms',
    name: 'TvmsRoot',
    redirect: '/tvms/index',
    component: Layout,
    meta: { title: '购票机台账', icon: renderIcon(ShoppingCartOutlined), sort: 8.2, permissions: ['ticket_tvms'] },
    children: [
      {
        path: 'index',
        name: 'ticket_tvms',
        meta: { title: '购票机台账' },
        component: () => import('@/views/ticket/tvms/index.vue'),
      },
    ],
  },
  {
    path: '/blacklist',
    name: 'BlacklistRoot',
    redirect: '/blacklist/index',
    component: Layout,
    meta: { title: '乘车人黑名单', icon: renderIcon(SafetyOutlined), sort: 8.3, permissions: ['ticket_blacklist'] },
    children: [
      {
        path: 'index',
        name: 'ticket_blacklist',
        meta: { title: '乘车人黑名单' },
        component: () => import('@/views/ticket/blacklist/index.vue'),
      },
    ],
  },
  {
    path: '/alerts',
    name: 'AlertsRoot',
    redirect: '/alerts/index',
    component: Layout,
    meta: { title: '告警中心', icon: renderIcon(BellOutlined), sort: 8.5, permissions: ['ticket_alerts'] },
    children: [
      {
        path: 'index',
        name: 'ticket_alerts',
        meta: { title: '告警中心' },
        component: () => import('@/views/ticket/alerts/index.vue'),
      },
    ],
  },
  {
    path: '/orders',
    name: 'OrdersRoot',
    redirect: '/orders/index',
    component: Layout,
    meta: { title: '订单管理', icon: renderIcon(ProfileOutlined), sort: 9, permissions: ['ticket_orders'] },
    children: [
      {
        path: 'index',
        name: 'ticket_orders',
        meta: { title: '订单管理' },
        component: () => import('@/views/ticket/orders/index.vue'),
      },
    ],
  },
  {
    path: '/invoices',
    name: 'InvoicesRoot',
    redirect: '/invoices/index',
    component: Layout,
    meta: { title: '发票管理', icon: renderIcon(FileTextOutlined), sort: 10, permissions: ['ticket_invoices'] },
    children: [
      {
        path: 'index',
        name: 'ticket_invoices',
        meta: { title: '发票管理' },
        component: () => import('@/views/ticket/invoices/index.vue'),
      },
    ],
  },
  {
    path: '/settings',
    name: 'SettingsRoot',
    redirect: '/settings/index',
    component: Layout,
    meta: { title: '系统设置', icon: renderIcon(SettingOutlined), sort: 11, permissions: ['ticket_settings'] },
    children: [
      {
        path: 'index',
        name: 'ticket_settings',
        meta: { title: '系统设置' },
        component: () => import('@/views/ticket/settings/index.vue'),
      },
    ],
  },
  {
    path: '/logs',
    name: 'LogsRoot',
    redirect: '/logs/index',
    component: Layout,
    meta: { title: '日志管理', icon: renderIcon(FileTextOutlined), sort: 12, permissions: ['ticket_logs'] },
    children: [
      {
        path: 'index',
        name: 'ticket_logs',
        meta: { title: '日志管理' },
        component: () => import('@/views/ticket/logs/index.vue'),
      },
    ],
  },
  {
    path: '/about',
    name: 'AboutRoot',
    redirect: '/about/index',
    component: Layout,
    meta: { title: '关于', icon: renderIcon(InfoCircleOutlined), sort: 13, permissions: ['ticket_about'] },
    children: [
      {
        path: 'index',
        name: 'ticket_about',
        meta: { title: '关于' },
        component: () => import('@/views/ticket/about/index.vue'),
      },
    ],
  },
];

export default routes;
