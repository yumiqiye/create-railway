/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
import { Alova } from '@/utils/http/alova/index';

export interface CityItem {
  id: string;
  name: string;
  pinyin: string;
  code: string;
  stationCount?: number;
}

export interface StationItem {
  id: string;
  name: string;
  cityId: string;
  cityName?: string;
  code: string;
  status?: 'normal' | 'maintenance' | 'closed';
  gateCount?: number;
  platformCount?: number;
  address?: string;
  trainCount?: number;
}

export interface SeatItem {
  type: string;
  price: number;
  total: number;
  sold?: number;
  remaining?: number;
}

export interface TrainItem {
  id: string;
  trainNo: string;
  type: string;
  fromStationId: string;
  fromStationName: string;
  fromCityName: string;
  toStationId: string;
  toStationName: string;
  toCityName: string;
  departTime: string;
  baseDepartTime?: string;
  arriveTime: string;
  duration: number;
  durationText: string;
  platform: string;
  basePlatform?: string;
  gates?: string[];
  baseGates?: string[];
  tempGates?: string[];
  tempGate?: string;
  tempPlatform?: string;
  gate: string;
  baseGate?: string;
  status?: string;
  statusText?: string;
  delayMinutes?: number;
  runtimeNote?: string;
  runtimeDate?: string;
  runtimeOverridden?: boolean;
  runtimeByDate?: Record<
    string,
    {
      status: string;
      delayMinutes: number;
      tempGates: string[];
      tempGate: string;
      tempPlatform: string;
      runtimeNote: string;
      updatedAt?: string;
    }
  >;
  landmarkColor: string;
  seats: SeatItem[];
  stops?: { stationId: string; name: string; km: number }[];
  totalRemaining: number;
  lowestPrice: number;
}

export interface PassengerItem {
  name: string;
  idType: string;
  idNo: string;
  phone: string;
  type?: string;
  price?: number;
}

export interface OrderItem {
  id: string;
  orderNo: string;
  trainNo: string;
  trainId: string;
  date: string;
  seatType: string;
  price: number;
  totalPrice: number;
  status: 'paid' | 'refunded' | 'canceled';
  contactPhone: string;
  passengers: PassengerItem[];
  createdAt: string;
  updatedAt?: string;
  checkedIn?: boolean;
  checkedInAt?: string;
  invoiceNo?: string;
  invoiceStatus?: 'issued' | 'redFlushed' | '';
  invoiceTitle?: string;
  invoiceTaxNo?: string;
  invoiceIssuedAt?: string;
  invoiceRedFlushedAt?: string;
  invoiceRedFlushReason?: string;
  lostReported?: boolean;
  lostReportedAt?: string;
  lostReissueOrderNo?: string;
  voided?: boolean;
  voidedReason?: string;
  source?: string;
  refundFee?: number;
  refundAmount?: number;
  refundRate?: number;
  changeFee?: number;
  route?: {
    trainNo: string;
    fromStationName: string;
    toStationName: string;
    fromCityName: string;
    toCityName: string;
    departTime: string;
    arriveTime: string;
    durationText: string;
    platform?: string;
    gate?: string;
    landmarkColor?: string;
  };
}

/* ---------------- 城市 ---------------- */
export const getCityList = () => Alova.Get<CityItem[]>('/ticket/cities');
export const createCity = (data: Partial<CityItem>) => Alova.Post('/ticket/cities', data);
export const updateCity = (id: string, data: Partial<CityItem>) =>
  Alova.Put(`/ticket/cities/${id}`, data);
export const deleteCity = (id: string) => Alova.Delete(`/ticket/cities/${id}`);

/* ---------------- 车站 ---------------- */
export const getStationList = (params?: { cityId?: string; keyword?: string }) =>
  Alova.Get<StationItem[]>('/ticket/stations', { params });
export const createStation = (data: Partial<StationItem>) => Alova.Post('/ticket/stations', data);
export const updateStation = (id: string, data: Partial<StationItem>) =>
  Alova.Put(`/ticket/stations/${id}`, data);
export const deleteStation = (id: string) => Alova.Delete(`/ticket/stations/${id}`);

/* ---------------- 车次 ---------------- */
export const getTrainList = (params?: { keyword?: string; date?: string }) =>
  Alova.Get<TrainItem[]>('/ticket/trains', { params });
export const createTrain = (data: Recordable) => Alova.Post('/ticket/trains', data);
export const updateTrain = (id: string, data: Recordable) => Alova.Put(`/ticket/trains/${id}`, data);
export const deleteTrain = (id: string) => Alova.Delete(`/ticket/trains/${id}`);

/* ---------------- 批量导入 ---------------- */
export type ImportType = 'cities' | 'stations' | 'trains';
export interface ImportMessage {
  row: number;
  type: 'skip' | 'error';
  message: string;
}
export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  messages: ImportMessage[];
}
export const importTicketData = (type: ImportType, rows: Record<string, any>[]) =>
  Alova.Post<ImportResult>(`/import/${type}`, { rows });

/* ---------------- 订单 ---------------- */
export const getOrderList = (params?: { keyword?: string; status?: string }) =>
  Alova.Get<OrderItem[]>('/ticket/orders', { params });
export const getOrderDetail = (id: string) => Alova.Get<OrderItem>(`/ticket/orders/${id}`);
export const updateOrderStatus = (id: string, status: string) =>
  Alova.Put(`/ticket/orders/${id}/status`, { status });
export const deleteOrder = (id: string) => Alova.Delete(`/ticket/orders/${id}`);
export const createAgentOrder = (data: {
  phone: string;
  trainId: string;
  date: string;
  seatType: string;
  contactPhone?: string;
  agent?: string;
  passengers: PassengerItem[];
}) => Alova.Post<OrderItem>('/orders', data);

/** 售票窗口出票：手机号可空，订单不归属前台账号 */
export const createCounterSale = (data: {
  phone?: string;
  trainId: string;
  date: string;
  seatType: string;
  contactPhone?: string;
  agent?: string;
  passengers: PassengerItem[];
}) => Alova.Post<OrderItem>('/orders', data);

/* ---------------- 补票 ---------------- */
export interface SupplementPayload {
  phone: string;
  name: string;
  idType?: string;
  idNo: string;
  type?: string;
  trainId: string;
  date: string;
  seatType: string;
  reason: string;
  originalOrderNo?: string;
  fromStationId?: string;
  toStationId?: string;
  agent?: string;
}
export const getSupplementList = (params?: { keyword?: string }) =>
  Alova.Get<OrderItem[]>('/ticket/supplement', { params });
export const createSupplementOrder = (data: SupplementPayload) =>
  Alova.Post<OrderItem>('/ticket/supplement', data);
export const getSupplementQuote = (params: {
  trainId: string;
  seatType: string;
  fromStationId: string;
  toStationId: string;
}) => Alova.Get<{ fare: number; segmentKm: number; totalKm: number; from: any; to: any; stops: any[] }>(
  '/ticket/supplement/quote',
  { params }
);
export const getSupplementOriginal = (orderNo: string) =>
  Alova.Get<any>('/ticket/supplement/original', { params: { orderNo } });

/* ---------------- 运行时端口配置 ---------------- */
export interface RuntimeConfig {
  ports: { ticket: number; check: number; admin: number };
  urls: { ticket: string; checkin: string; admin: string };
}
export const getRuntimeConfig = () => Alova.Get<RuntimeConfig>('/ticket/runtime-config');

/* ---------------- 后台账号 ---------------- */
export interface AccountItem {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'operator' | 'inspector';
  phone?: string;
  enabled: boolean;
  createdAt?: string;
}
export const loginAccount = (data: { username: string; password: string }) =>
  Alova.Post<{ token: string; account: AccountItem }>('/accounts/login', data);
export const getAccountList = () => Alova.Get<AccountItem[]>('/accounts');
export const createAccount = (data: { username: string; name: string; role: string; password: string; phone?: string }) =>
  Alova.Post<AccountItem>('/accounts', data);
export const updateAccount = (id: string, data: Partial<AccountItem>) => Alova.Put<AccountItem>(`/accounts/${id}`, data);
export const updateAccountPassword = (id: string, password: string) =>
  Alova.Put(`/accounts/${id}/password`, { password });
export const deleteAccount = (id: string) => Alova.Delete(`/accounts/${id}`);

/* ---------------- 概览 ---------------- */
export interface TicketSeatItem {
  type: string;
  price: number;
  capacity: number;
  quota: number;
  sold: number;
  remaining: number;
}

export interface TicketRow {
  trainId: string;
  trainNo: string;
  type: string;
  date: string;
  fromStationName: string;
  toStationName: string;
  departTime: string;
  arriveTime: string;
  durationText: string;
  seats: TicketSeatItem[];
  quota: number;
  sold: number;
  remaining: number;
}

export interface StatsResult {
  date: string;
  cityCount: number;
  stationCount: number;
  trainCount: number;
  orderCount: number;
  paidOrderCount: number;
  todayOrderCount: number;
  ticketCount: number;
  todayTicketCount: number;
  revenue: number;
  todayRevenue: number;
  quota: { seats: number; sold: number; remaining: number; utilization: number };
  seatTypes: { type: string; quota: number; sold: number; remaining: number }[];
  trainQuotas: TicketRow[];
  recentOrders: OrderItem[];
}
export const getStats = (params?: { date?: string }) =>
  Alova.Get<StatsResult>('/ticket/stats', { params });

/* ---------------- 车票管理（按日期设置票额） ---------------- */
export const getTicketList = (params?: { date?: string; keyword?: string }) =>
  Alova.Get<{ date: string; total: number; list: TicketRow[] }>('/ticket/tickets', { params });
export const saveTrainQuota = (trainId: string, data: { date: string; seats: { type: string; quota: number }[] }) =>
  Alova.Put<TicketRow>(`/ticket/tickets/${trainId}`, data);

/* ---------------- 系统设置 ---------------- */
export interface RefundRule {
  hours: number;
  rate: number;
}

export interface SettingsItem {
  siteName: string;
  subtitle: string;
  announcement: string;
  maxPassengersPerOrder: number;
  presaleDays: number;
  paymentTimeoutMinutes?: number;
  refundEnabled: boolean;
  servicePhone: string;
  refundRules: RefundRule[];
  changeFeeRate: number;
  childDiscount: number;
  checkinMinutes: number;
  entryWelcomeText: string;
  exitWelcomeText: string;
  announcementEnabled?: boolean;
  announcementShowMode?: 'top' | 'modal';
  announcementOnStart?: boolean;
  announcementRepeat?: boolean;
  footerCopyright?: string;
  footerIcp?: string;
  footerPolice?: string;
  footerPoliceNo?: string;
  maintenanceText?: string;
  liveDetection?: boolean;
  showScanPreview?: boolean;
  ticketQrRefreshSeconds?: number;
  /* 铁路品牌（模组售票机公告栏 / 闸机提示同步） */
  systemName?: string;
  logoUrl?: string;
  railwayBureau?: string;
  railwayCurrency?: string;
  farePerBlock?: number;
  minFare?: number;
  maxFare?: number;
  railwayAdminToken?: string;
}
export const getSettings = () => Alova.Get<SettingsItem>('/ticket/settings');
export const updateSettings = (data: Partial<SettingsItem>) => Alova.Put<SettingsItem>('/ticket/settings', data);

/* ---------------- 铁路附属：票价 / 铁路局 / 模组车站 ---------------- */
export interface RailwayFare {
  id: string;
  key: string;
  fromStationId: string;
  toStationId: string;
  fromStationName: string;
  toStationName: string;
  distance: number;
  autoPrice: number;
  price: number;
  currency: string;
  custom: boolean;
  updatedAt?: string;
}
export const getRailwayFares = () => Alova.Get<RailwayFare[]>('/ticket/railway/admin/fares');
export const saveRailwayFare = (data: { fromStationId: string; toStationId: string; price?: number; distance?: number }) =>
  Alova.Post<RailwayFare>('/ticket/railway/admin/fares', data);
export const updateRailwayFare = (id: string, data: { price?: number; distance?: number; resetAuto?: boolean }) =>
  Alova.Put<RailwayFare>(`/ticket/railway/admin/fares/${id}`, data);
export const deleteRailwayFare = (id: string) => Alova.Delete<null>(`/ticket/railway/admin/fares/${id}`);
export const recalcRailwayFares = () => Alova.Post<{ recalculated: number }>('/ticket/railway/admin/fares/recalculate', {});

export interface RailwayBureau {
  id: string;
  name: string;
  shortName: string;
  color: string;
  remark?: string;
  createdAt?: string;
}
export const getRailwayBureaus = () => Alova.Get<RailwayBureau[]>('/ticket/railway/admin/bureaus');
export const createRailwayBureau = (data: Partial<RailwayBureau>) =>
  Alova.Post<RailwayBureau>('/ticket/railway/admin/bureaus', data);
export const updateRailwayBureau = (id: string, data: Partial<RailwayBureau>) =>
  Alova.Put<RailwayBureau>(`/ticket/railway/admin/bureaus/${id}`, data);
export const deleteRailwayBureau = (id: string) => Alova.Delete<null>(`/ticket/railway/admin/bureaus/${id}`);

export interface RailwayStationGeo {
  id: string;
  name: string;
  code: string;
  x: number;
  y: number;
  z: number;
  dimension: string;
  bureauId: string;
  bureauName?: string;
  gates: { x: number; y: number; z: number }[];
  vendors: { x: number; y: number; z: number }[];
  updatedAt?: string;
}
export const getRailwayStations = () => Alova.Get<RailwayStationGeo[]>('/ticket/railway/admin/stations');

/* ---------------- 发票管理 ---------------- */
export const getInvoiceList = (params?: { status?: string }) => Alova.Get<OrderItem[]>('/invoices', { params });
export const redFlushInvoice = (orderNo: string, reason?: string) =>
  Alova.Post<OrderItem>(`/invoices/${orderNo}/red-flush`, { reason });

/* ---------------- 检票监控 / 设备 / 复核 ---------------- */
export interface MonitorPassenger {
  name: string;
  idNo: string;
  checkedIn: boolean;
  checkedInAt?: string;
  exception?: string;
}
export interface MonitorOrder {
  orderNo: string;
  trainNo: string;
  date: string;
  seatType: string;
  passengers: MonitorPassenger[];
  checkedCount: number;
  passengerCount: number;
  checkedIn: boolean;
}
export interface DeviceRemoteConfig {
  mode?: 'auto' | 'manual';
  cameraEnabled?: boolean;
  showScanPreview?: boolean;
  welcomeText?: string;
  gateType?: 'entry' | 'exit' | 'checkin';
  status?: 'normal' | 'disabled' | 'maintenance';
  maintenanceText?: string;
}
export interface DeviceItem {
  id: string;
  stationId: string;
  gateNo: string;
  name: string;
  gateType: 'entry' | 'exit' | 'checkin';
  status: 'normal' | 'disabled' | 'maintenance';
  maintenanceText?: string;
  lastSeenAt?: string;
  online?: boolean;
  configVersion?: number;
  configUpdatedAt?: string;
  configAckVersion?: number;
  configAckedAt?: string;
  configError?: string;
  remoteConfig?: DeviceRemoteConfig;
  mode?: 'auto' | 'manual';
  cameraEnabled?: boolean;
  showScanPreview?: boolean;
  welcomeText?: string;
}
export interface CheckinEventItem {
  id: string;
  at: string;
  stationId?: string;
  gateNo?: string;
  type: string;
  level?: 'info' | 'warn' | 'error';
  detail: string;
}
export interface MonitorData {
  today: string;
  devices: DeviceItem[];
  onlineDeviceCount?: number;
  orders: MonitorOrder[];
  events: CheckinEventItem[];
  logs: LogItem[];
  wsUrl?: string;
  alerts?: { summary: AlertSummary; rows: AlertItem[] };
}
export const getMonitor = () => Alova.Get<MonitorData>('/monitor');
export const getDeviceList = () => Alova.Get<DeviceItem[]>('/devices');
export const createDevice = (data: Partial<DeviceItem>) => Alova.Post<DeviceItem>('/devices', data);
export const updateDevice = (id: string, data: Partial<DeviceItem>) =>
  Alova.Put<DeviceItem>(`/devices/${id}`, data);
export const reviewCheckin = (data: {
  orderNo: string;
  idNo: string;
  action: 'approve' | 'exception' | 'cancel';
  reason?: string;
}) => Alova.Post('/checkin_admin/review', data);

/* ---------------- 告警中心 ---------------- */
export interface AlertItem {
  id: string;
  at: string;
  lastAt: string;
  type: string;
  level: 'info' | 'warn' | 'error';
  title: string;
  detail: string;
  target?: string;
  source?: string;
  status: 'open' | 'ack' | 'ignored' | 'resolved';
  count: number;
  ackedBy?: string;
  ackedAt?: string;
  resolvedAt?: string;
  note?: string;
}
export interface AlertSummary {
  open: number;
  ack: number;
  ignored: number;
  resolved: number;
  critical: number;
  warn: number;
}
export const getAlertList = (params?: {
  status?: string;
  level?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) => Alova.Get<{ summary: AlertSummary; total: number; page: number; pageSize: number; rows: AlertItem[] }>('/alerts', { params });
export const updateAlert = (id: string, action: 'ack' | 'ignore' | 'resolve', note?: string) =>
  Alova.Post<AlertItem>(`/alerts/${id}`, { action, note });

/* ---------------- 运营报表 ---------------- */
export interface ReportSummary {
  orders: number;
  paidOrders: number;
  refundOrders: number;
  canceledOrders: number;
  ticketsSold: number;
  validTickets: number;
  refundTickets: number;
  grossRevenue: number;
  validRevenue: number;
  refundAmount: number;
  netRevenue: number;
  checkedPassengers: number;
  checkinRate: number;
  avgTicketPrice: number;
  trainCount: number;
  stationCount: number;
}
export interface ReportDailyRow {
  date: string;
  orders: number;
  paidOrders: number;
  refundOrders: number;
  canceledOrders: number;
  ticketsSold: number;
  validTickets: number;
  refundTickets: number;
  grossRevenue: number;
  validRevenue: number;
  refundAmount: number;
  netRevenue: number;
  checkedPassengers: number;
  checkinRate: number;
}
export interface ReportGroupRow {
  key: string;
  label: string;
  orders: number;
  ticketsSold: number;
  validTickets: number;
  refundTickets: number;
  grossRevenue: number;
  refundAmount: number;
  netRevenue: number;
  checkedPassengers: number;
  checkinRate: number;
  fromStationName?: string;
  toStationName?: string;
  departTime?: string;
  tripDates?: number;
}
export interface OperationsReport {
  from: string;
  to: string;
  summary: ReportSummary;
  daily: ReportDailyRow[];
  stations: ReportGroupRow[];
  trains: ReportGroupRow[];
  seatTypes: ReportGroupRow[];
  channels: ReportGroupRow[];
}
export const getOperationsReport = (params: { from: string; to: string }) =>
  Alova.Get<OperationsReport>('/reports', { params });


/* ---------------- 日志 ---------------- */
export interface LogItem {
  id: string;
  at: string;
  action: string;
  actor?: string;
  role?: string;
  target?: string;
  detail?: string;
  level?: 'info' | 'warn' | 'error';
}
export const getLogList = (params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  level?: string;
  role?: string;
  from?: string;
  to?: string;
}) => Alova.Get<{ total: number; page: number; pageSize: number; rows: LogItem[] }>('/logs', { params });
export const logTicketPrint = (orderNo: string, reprint = false) =>
  Alova.Post('/logs/print', { orderNo, reprint });

/* ---------------- 数据重置 ---------------- */
export const resetDemoData = (password: string) => Alova.Post('/admin/reset', { password });

