<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="检票管理">
        实时检票监控、人工复核、检票机设备与车站大屏集中在这里管理；数据通过 WebSocket 即时推送，也可手动刷新。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4">
      <n-tabs v-model:value="tab" type="line" animated>
        <n-tab-pane name="monitor" tab="实时监控">
          <n-grid :cols="4" :x-gap="12" responsive="screen" item-responsive>
            <n-grid-item span="1 s:1 m:1 l:1">
              <div class="stat-card">
                <span>今日已支付订单</span>
                <strong>{{ monitor.orders.length }}</strong>
              </div>
            </n-grid-item>
            <n-grid-item span="1 s:1 m:1 l:1">
              <div class="stat-card">
                <span>今日乘车人</span>
                <strong>{{ totalPassengers }}</strong>
              </div>
            </n-grid-item>
            <n-grid-item span="1 s:1 m:1 l:1">
              <div class="stat-card is-green">
                <span>已检票</span>
                <strong>{{ checkedPassengers }}</strong>
              </div>
            </n-grid-item>
            <n-grid-item span="1 s:1 m:1 l:1">
              <div class="stat-card is-blue">
                <span>在线检票机</span>
                <strong>{{ onlineDevices }}</strong>
              </div>
            </n-grid-item>
          </n-grid>

          <div class="toolbar mt-4">
            <n-space align="center">
              <n-tag :type="wsConnected ? 'success' : 'warning'" :bordered="false">
                {{ wsConnected ? 'WebSocket 实时连接中' : 'WebSocket 未连接，使用轮询' }}
              </n-tag>
              <span class="hint">最后更新：{{ lastUpdated || '-' }}</span>
            </n-space>
            <n-button size="small" quaternary :loading="loading" @click="loadMonitor">手动刷新</n-button>
          </div>

          <n-data-table
            :columns="monitorColumns"
            :data="monitor.orders"
            :loading="loading"
            :row-key="(row: MonitorOrder) => row.orderNo"
            :pagination="false"
            :max-height="420"
            :bordered="false"
            :single-line="false"
          />

          <n-card :bordered="false" class="mt-4" title="最近检票事件">
            <n-timeline v-if="monitor.events.length">
              <n-timeline-item
                v-for="event in monitor.events"
                :key="event.id"
                :type="event.level === 'error' ? 'error' : event.level === 'warn' ? 'warning' : 'success'"
                :title="eventLabel(event.type)"
                :content="event.detail"
                :time="formatTime(event.at)"
              />
            </n-timeline>
            <n-empty v-else description="暂无检票事件" />
          </n-card>
        </n-tab-pane>

        <n-tab-pane name="review" tab="人工复核">
          <n-alert type="info" :bordered="false" class="mb-4">
            检票异常时可在此人工放行或标记异常。放行会将该乘车人记为已检票，并写入审计日志。
          </n-alert>
          <n-data-table
            :columns="reviewColumns"
            :data="reviewRows"
            :loading="loading"
            :row-key="(row: ReviewRow) => row.key"
            :pagination="{ pageSize: 10 }"
            :bordered="false"
            :single-line="false"
          />
        </n-tab-pane>

        <n-tab-pane name="cancel" tab="取消检票">
          <n-alert type="warning" :bordered="false" class="mb-4">
            旅客已检票但未通过闸机时，可在此取消该乘车人的检票状态；取消后该票恢复为未检票，可重新检票。操作会写入审计日志。
          </n-alert>
          <n-data-table
            :columns="cancelColumns"
            :data="checkedRows"
            :loading="loading"
            :row-key="(row: ReviewRow) => row.key"
            :pagination="{ pageSize: 10 }"
            :bordered="false"
            :single-line="false"
          />
        </n-tab-pane>

        <n-tab-pane name="devices" tab="检票设备">
          <div class="checkin-rule">
            <span>开检提前时间</span>
            <n-input-number v-model:value="checkinMinutes" :min="5" :max="120" :precision="0" style="width: 120px">
              <template #suffix>分钟</template>
            </n-input-number>
            <n-button size="small" :loading="ruleSaving" @click="saveRule">保存规则</n-button>
          </div>
          <div class="toolbar">
            <n-space align="center">
              <n-tag type="success" :bordered="false">共 {{ monitor.devices.length }} 台</n-tag>
              <span class="hint">停用或维修中的检票机会在终端显示维修提示并停止摄像头。</span>
            </n-space>
            <n-button v-if="isAdmin" type="primary" size="small" @click="openDeviceCreate">新增检票机</n-button>
          </div>
          <n-data-table
            :columns="deviceColumns"
            :data="monitor.devices"
            :loading="loading"
            :row-key="(row: DeviceItem) => row.id"
            :pagination="false"
            :bordered="false"
            :single-line="false"
          />
        </n-tab-pane>

        <n-tab-pane name="screen" tab="车站大屏">
          <div class="toolbar">
            <n-space align="center">
              <n-select
                v-model:value="screenStationId"
                :options="stationOptions"
                placeholder="选择要展示的车站"
                style="width: 220px"
              />
              <n-button size="small" quaternary @click="screenFull = true">全屏预览</n-button>
            </n-space>
            <span class="hint">大屏按所选车站展示今日车次、检票口与已检票人数，适合车站候车厅投屏。</span>
          </div>
          <div class="station-screen">
            <header class="screen-head">
              <div>
                <h1>{{ currentStationName }}</h1>
                <p>{{ currentStation?.address || '清江铁路 · 车站候车厅实时信息' }}</p>
              </div>
              <div class="screen-clock">
                <strong>{{ clock }}</strong>
                <span>{{ monitor.today }}</span>
              </div>
            </header>
            <div class="screen-body">
              <section class="screen-trains">
                <h2>今日车次</h2>
                <div v-for="train in screenTrains" :key="train.id" class="screen-train">
                  <div class="train-no">{{ train.trainNo }}</div>
                  <div class="train-route">
                    <strong>{{ train.fromStationName }} → {{ train.toStationName }}</strong>
                    <span>检票口 {{ train.gate || '-' }}　站台 {{ train.platform || '-' }}</span>
                  </div>
                  <div class="train-time">
                    <strong>{{ train.departTime }}</strong>
                    <span>{{ train.arriveTime }} 到达</span>
                  </div>
                  <div class="train-state" :class="{ hot: trainPercent(train.trainNo) > 60 }">
                    <strong>{{ trainChecked(train.trainNo) }}</strong>
                    <span>已检票</span>
                  </div>
                </div>
                <n-empty v-if="!screenTrains.length" description="该车站今日暂无车次" />
              </section>
              <aside class="screen-side">
                <h2>检票口状态</h2>
                <div class="screen-gates">
                  <div v-for="gate in screenGates" :key="gate.key" class="screen-gate" :class="{ off: gate.status !== 'normal' }">
                    <strong>{{ gate.gateNo }}</strong>
                    <span>{{ gate.status === 'normal' ? '正常' : gate.status === 'maintenance' ? '维修' : '本机停用' }}</span>
                  </div>
                  <div v-if="!screenGates.length" class="screen-empty">暂无检票机</div>
                </div>
                <div class="screen-notice">
                  <h3>温馨提示</h3>
                  <p>请提前准备好电子车票，刷码并配合人脸核验；一人一闸，有序进站。</p>
                </div>
              </aside>
            </div>
            <span class="screen-footer">{{ footerText }}</span>
          </div>
        </n-tab-pane>
      </n-tabs>
    </n-card>

    <n-modal v-model:show="deviceModal" preset="card" :title="deviceEditingId ? '编辑检票机' : '新增检票机'" style="width: 520px">
      <n-form label-placement="left" label-width="90">
        <n-form-item label="所属车站">
          <n-select v-model:value="deviceForm.stationId" :options="stationOptions" filterable />
        </n-form-item>
        <n-form-item label="检票机编号">
          <n-input v-model:value="deviceForm.gateNo" placeholder="例如 QJ-01" maxlength="20" />
        </n-form-item>
        <n-form-item label="设备名称">
          <n-input v-model:value="deviceForm.name" placeholder="可选" maxlength="30" />
        </n-form-item>
        <n-form-item label="设备类型">
          <n-select v-model:value="deviceForm.gateType" :options="gateTypeOptions" />
        </n-form-item>
        <n-form-item label="状态">
          <n-select v-model:value="deviceForm.status" :options="deviceStatusOptions" />
        </n-form-item>
        <n-form-item label="维修文案">
          <n-input v-model:value="deviceForm.maintenanceText" type="textarea" :rows="2" maxlength="80" placeholder="留空使用系统设置中的全局维修文案" />
        </n-form-item>
        <n-form-item label="检票模式">
          <n-select v-model:value="deviceForm.mode" :options="[{ label: '自动检票', value: 'auto' }, { label: '人工辅助', value: 'manual' }]" />
        </n-form-item>
        <n-form-item label="摄像头">
          <n-switch v-model:value="deviceForm.cameraEnabled" />
        </n-form-item>
        <n-form-item label="扫码小窗">
          <n-switch v-model:value="deviceForm.showScanPreview" />
        </n-form-item>
        <n-form-item label="欢迎语">
          <n-input v-model:value="deviceForm.welcomeText" maxlength="80" placeholder="可选，留空使用默认欢迎语" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="deviceModal = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="saveDevice">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="reviewModal"
      preset="card"
      :title="reviewTarget.action === 'cancel' ? '取消检票' : '人工复核'"
      style="width: 480px"
    >
      <n-descriptions :column="1" label-placement="left" size="small" bordered>
        <n-descriptions-item label="订单号">{{ reviewTarget.orderNo }}</n-descriptions-item>
        <n-descriptions-item label="乘车人">{{ reviewTarget.name }} / {{ reviewTarget.idNo }}</n-descriptions-item>
        <n-descriptions-item label="操作">
          {{ reviewTarget.action === 'approve' ? '人工放行' : reviewTarget.action === 'exception' ? '标记异常' : '取消检票' }}
        </n-descriptions-item>
      </n-descriptions>
      <n-alert v-if="reviewTarget.action === 'cancel'" type="warning" :bordered="false" style="margin-top: 16px">
        取消后该乘车人恢复为未检票，可重新检票；已进站的旅客请确认后再操作。
      </n-alert>
      <n-form-item v-if="reviewTarget.action === 'exception'" label="异常原因" style="margin-top: 16px">
        <n-input v-model:value="reviewTarget.reason" type="textarea" :rows="3" maxlength="100" placeholder="例如：人脸识别多次失败，需人工核验证件" />
      </n-form-item>
      <template #footer>
        <n-space justify="end">
          <n-button @click="reviewModal = false">取消</n-button>
          <n-button type="primary" :loading="reviewing" @click="submitReview">
            {{ reviewTarget.action === 'approve' ? '确认放行' : reviewTarget.action === 'exception' ? '确认标记' : '确认取消' }}
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="screenFull" preset="card" title="车站大屏全屏预览" style="width: 92vw">
      <iframe :srcdoc="screenHtml" class="screen-frame" />
    </n-modal>
  </div>
</template>

<script lang="ts" setup>
  import { computed, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
  import { NButton, NTag, useMessage } from 'naive-ui';
  import type { DataTableColumns, SelectOption } from 'naive-ui';
  import { useUserStore } from '@/store/modules/user';
  import {
    createDevice,
    getDeviceList,
    getMonitor,
    getStationList,
    getSettings,
    getTrainList,
    reviewCheckin,
    updateDevice,
    updateSettings,
    type DeviceItem,
    type MonitorData,
    type MonitorOrder,
    type StationItem,
    type TrainItem,
  } from '@/api/ticket';

  const message = useMessage();
  const userStore = useUserStore();
  const isAdmin = computed(() => (userStore.info as any)?.role === 'admin');

  const tab = ref('monitor');
  const loading = ref(false);
  const saving = ref(false);
  const reviewing = ref(false);
  const monitor = reactive<MonitorData>({ today: '', devices: [], orders: [], events: [], logs: [] });
  const lastUpdated = ref('');
  const wsConnected = ref(false);
  const ws = ref<WebSocket | null>(null);
  const pollTimer = ref<number>(0);

  const stations = ref<StationItem[]>([]);
  const trains = ref<TrainItem[]>([]);
  const screenStationId = ref<string | null>(null);
  const screenFull = ref(false);
  const clock = ref(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
  let clockTimer = 0;

  const stationOptions = computed<SelectOption[]>(() =>
    stations.value.map((s) => ({ label: s.name, value: s.id }))
  );

  const totalPassengers = computed(() =>
    monitor.orders.reduce((sum, o) => sum + o.passengerCount, 0)
  );
  const checkedPassengers = computed(() =>
    monitor.orders.reduce((sum, o) => sum + o.checkedCount, 0)
  );
  const onlineDevices = computed(() =>
    monitor.devices.filter((d) => d.online).length
  );

  const monitorColumns: DataTableColumns<MonitorOrder> = [
    { title: '订单号', key: 'orderNo', width: 200 },
    { title: '车次', key: 'trainNo', width: 100 },
    { title: '席别', key: 'seatType', width: 90 },
    {
      title: '检票进度',
      key: 'progress',
      width: 110,
      render: (row) =>
        h(
          NTag,
          { size: 'small', type: row.checkedCount === row.passengerCount ? 'success' : row.checkedCount ? 'warning' : 'error', bordered: false },
          { default: () => `${row.checkedCount}/${row.passengerCount}` }
        ),
    },
    {
      title: '乘车人',
      key: 'passengers',
      render: (row) =>
        h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, row.passengers.map((p) =>
          h(
            NTag,
            { size: 'small', type: p.checkedIn ? 'success' : p.exception ? 'error' : 'default', bordered: false },
            { default: () => `${p.name}${p.checkedIn ? ' 已检' : p.exception ? ' 异常' : ' 未检'}` }
          )
        )),
    },
  ];

  interface ReviewRow extends MonitorOrder {
    key: string;
    name: string;
    idNo: string;
    checkedIn: boolean;
    checkedInAt?: string;
    exception?: string;
  }

  const reviewRows = computed<ReviewRow[]>(() =>
    monitor.orders.flatMap((order) =>
      order.passengers
        .filter((p) => !(p.checkedIn || order.checkedIn) || p.exception)
        .map((p) => ({
          ...order,
          key: `${order.orderNo}-${p.idNo}`,
          name: p.name,
          idNo: p.idNo,
          checkedIn: p.checkedIn,
          checkedInAt: p.checkedInAt,
          exception: p.exception,
        }))
    )
  );

  const checkedRows = computed<ReviewRow[]>(() =>
    monitor.orders.flatMap((order) =>
      order.passengers
        .filter((p) => p.checkedIn || order.checkedIn)
        .map((p) => ({
          ...order,
          key: `${order.orderNo}-${p.idNo}`,
          name: p.name,
          idNo: p.idNo,
          checkedIn: p.checkedIn,
          checkedInAt: p.checkedInAt,
          exception: p.exception,
        }))
    )
  );

  const reviewColumns: DataTableColumns<ReviewRow> = [
    { title: '订单号', key: 'orderNo', width: 190 },
    { title: '车次', key: 'trainNo', width: 90 },
    { title: '乘车人', key: 'name', width: 100 },
    { title: '证件号', key: 'idNo', width: 190 },
    {
      title: '状态',
      key: 'state',
      width: 100,
      render: (row) =>
        h(NTag, { size: 'small', type: row.exception ? 'error' : 'warning', bordered: false }, {
          default: () => (row.exception ? '异常' : '未检票'),
        }),
    },
    { title: '异常说明', key: 'exception' },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (row) =>
        h('div', { style: 'display:flex;gap:6px' }, [
          h(NButton, { size: 'tiny', type: 'primary', onClick: () => openReview(row, 'approve') }, { default: () => '放行' }),
          h(NButton, { size: 'tiny', type: 'error', quaternary: true, onClick: () => openReview(row, 'exception') }, { default: () => '标记异常' }),
        ]),
    },
  ];

  const cancelColumns: DataTableColumns<ReviewRow> = [
    { title: '订单号', key: 'orderNo', width: 190 },
    { title: '车次', key: 'trainNo', width: 90 },
    { title: '乘车人', key: 'name', width: 100 },
    { title: '证件号', key: 'idNo', width: 190 },
    {
      title: '检票时间',
      key: 'checkedInAt',
      width: 170,
      render: (row) => (row.checkedInAt ? new Date(row.checkedInAt).toLocaleString('zh-CN') : '—'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (row) =>
        h(
          NButton,
          { size: 'tiny', type: 'warning', onClick: () => openReview(row, 'cancel') },
          { default: () => '取消检票' }
        ),
    },
  ];

  const deviceStatusOptions = [
    { label: '正常', value: 'normal' },
    { label: '维护中', value: 'maintenance' },
    { label: '停用（本机停用）', value: 'disabled' },
  ];
  const gateTypeOptions = [
    { label: '检票闸机', value: 'checkin' },
    { label: '进站闸机', value: 'entry' },
    { label: '出站闸机', value: 'exit' },
  ];
  const statusText: Record<string, string> = { normal: '正常', maintenance: '维护中', disabled: '本机停用' };

  const deviceColumns: DataTableColumns<DeviceItem> = [
    {
      title: '检票机',
      key: 'name',
      render: (row) =>
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [
          h('strong', null, row.name || row.gateNo),
          h('span', { style: 'color:#9aa3b2;font-size:12px' }, row.gateNo),
        ]),
    },
    {
      title: '车站',
      key: 'station',
      render: (row) => stations.value.find((s) => s.id === row.stationId)?.name || row.stationId,
    },
    { title: '类型', key: 'gateType', render: (row) => ({ checkin: '检票', entry: '进站', exit: '出站' }[row.gateType] || '检票') },
    {
      title: '在线',
      key: 'online',
      width: 80,
      render: (row) =>
        h(NTag, { size: 'small', type: row.online ? 'success' : 'default', bordered: false }, {
          default: () => (row.online ? '在线' : '离线'),
        }),
    },
    {
      title: '配置',
      key: 'config',
      width: 130,
      render: (row) => {
        const version = Number(row.configVersion || 0);
        const ack = Number(row.configAckVersion || 0);
        if (row.configError) return h(NTag, { size: 'small', type: 'error', bordered: false }, { default: () => '下发失败' });
        if (version && ack >= version) return h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => `v${version} 已生效` });
        if (version) return h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => `v${version} 待确认` });
        return h('span', { style: 'color:#9aa3b2;font-size:12px' }, '未下发');
      },
    },
    {
      title: '状态',
      key: 'status',
      render: (row) =>
        h(NTag, { size: 'small', type: row.status === 'normal' ? 'success' : row.status === 'maintenance' ? 'warning' : 'error', bordered: false }, {
          default: () => statusText[row.status] || '正常',
        }),
    },
    { title: '维修文案', key: 'maintenanceText', ellipsis: { tooltip: true } },
    { title: '最后在线', key: 'lastSeenAt', render: (row) => (row.lastSeenAt ? formatTime(row.lastSeenAt) : '未上报') },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      render: (row) =>
        h(NButton, {
          size: 'small',
          quaternary: true,
          type: 'primary',
          disabled: !isAdmin.value,
          onClick: () => openDeviceEdit(row),
        }, { default: () => '编辑' }),
    },
  ];

  const deviceModal = ref(false);
  const checkinMinutes = ref(30);
  const ruleSaving = ref(false);
  const deviceEditingId = ref('');
  const deviceForm = reactive<Partial<DeviceItem>>({
    stationId: '',
    gateNo: '',
    name: '',
    gateType: 'checkin',
    status: 'normal',
    maintenanceText: '',
    mode: 'auto',
    cameraEnabled: true,
    showScanPreview: false,
    welcomeText: '',
  });

  const reviewModal = ref(false);
  const reviewTarget = reactive({
    orderNo: '',
    idNo: '',
    name: '',
    action: 'approve' as 'approve' | 'exception' | 'cancel',
    reason: '',
  });

  function formatTime(value?: string) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  function eventLabel(type: string) {
    return ({ 'checkin-ok': '检票成功', 'verify-failed': '验票失败', duplicate: '重复检票', 'access-ok': '通行成功', 'access-failed': '通行失败' } as Record<string, string>)[type] || type;
  }

  async function loadMonitor() {
    loading.value = true;
    try {
      const data = (await getMonitor()) as MonitorData;
      Object.assign(monitor, data, { devices: data.devices || [], orders: data.orders || [], events: data.events || [], logs: data.logs || [] });
      lastUpdated.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      if (data.wsUrl) connectWs(data.wsUrl);
    } catch (e: any) {
      message.error(e.message || '监控数据加载失败');
    } finally {
      loading.value = false;
    }
  }

  function connectWs(url: string) {
    if (ws.value || !url) return;
    try {
      const socket = new WebSocket(url);
      socket.onopen = () => {
        wsConnected.value = true;
      };
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'checkin' && msg.payload) {
            Object.assign(monitor, msg.payload);
            lastUpdated.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          }
          if (msg.type === 'devices' && Array.isArray(msg.payload)) monitor.devices = msg.payload;
        } catch (e) {
          /* ignore */
        }
      };
      socket.onclose = () => {
        wsConnected.value = false;
        ws.value = null;
        window.setTimeout(() => connectWs(url), 5000);
      };
      socket.onerror = () => {
        wsConnected.value = false;
      };
      ws.value = socket;
    } catch (e) {
      wsConnected.value = false;
    }
  }

  function openReview(row: ReviewRow, action: 'approve' | 'exception' | 'cancel') {
    reviewTarget.orderNo = row.orderNo;
    reviewTarget.idNo = row.idNo;
    reviewTarget.name = row.name;
    reviewTarget.action = action;
    reviewTarget.reason = row.exception || '';
    reviewModal.value = true;
  }

  async function submitReview() {
    reviewing.value = true;
    try {
      await reviewCheckin({
        orderNo: reviewTarget.orderNo,
        idNo: reviewTarget.idNo,
        action: reviewTarget.action,
        reason: reviewTarget.reason,
      });
      message.success(
        reviewTarget.action === 'approve'
          ? '已人工放行'
          : reviewTarget.action === 'exception'
            ? '已标记异常'
            : '已取消检票'
      );
      reviewModal.value = false;
      await loadMonitor();
    } catch (e: any) {
      message.error(e.message || '人工复核失败');
    } finally {
      reviewing.value = false;
    }
  }

  function openDeviceCreate() {
    deviceEditingId.value = '';
    Object.assign(deviceForm, {
      stationId: screenStationId.value || '',
      gateNo: '',
      name: '',
      gateType: 'checkin',
      status: 'normal',
      maintenanceText: '',
      mode: 'auto',
      cameraEnabled: true,
      showScanPreview: false,
      welcomeText: '',
    });
    deviceModal.value = true;
  }

  function openDeviceEdit(row: DeviceItem) {
    deviceEditingId.value = row.id;
    Object.assign(deviceForm, row, {
      mode: row.remoteConfig?.mode || 'auto',
      cameraEnabled: row.remoteConfig?.cameraEnabled !== false,
      showScanPreview: !!row.remoteConfig?.showScanPreview,
      welcomeText: row.remoteConfig?.welcomeText || '',
    });
    deviceModal.value = true;
  }

  async function saveDevice() {
    if (!deviceForm.stationId || !deviceForm.gateNo) return message.warning('请选择车站并填写检票机编号');
    saving.value = true;
    try {
      if (deviceEditingId.value) await updateDevice(deviceEditingId.value, deviceForm as any);
      else await createDevice(deviceForm as any);
      message.success('检票机已保存');
      deviceModal.value = false;
      await loadMonitor();
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      saving.value = false;
    }
  }

  const currentStation = computed(() => stations.value.find((s) => s.id === screenStationId.value));
  const currentStationName = computed(() => currentStation.value?.name || '清江铁路');
  const screenTrains = computed(() =>
    trains.value.filter((t) => !screenStationId.value || t.fromStationId === screenStationId.value).slice(0, 8)
  );
  const screenGates = computed(() =>
    monitor.devices
      .filter((d) => !screenStationId.value || d.stationId === screenStationId.value)
      .map((d) => ({ ...d, key: d.id }))
  );

  function trainChecked(trainNo: string) {
    return monitor.orders.filter((o) => o.trainNo === trainNo).reduce((sum, o) => sum + o.checkedCount, 0);
  }
  function trainPercent(trainNo: string) {
    const orders = monitor.orders.filter((o) => o.trainNo === trainNo);
    const total = orders.reduce((sum, o) => sum + o.passengerCount, 0);
    return total ? Math.round((trainChecked(trainNo) / total) * 100) : 0;
  }

  const footerText = computed(() => {
    const parts = [currentStation.value?.address, '清江铁路12306'];
    return parts.filter(Boolean).join(' · ');
  });

  const screenHtml = computed(() => {
    const station = currentStationName.value;
    const rows = screenTrains.value
      .map(
        (t) => `<div class="row"><b>${t.trainNo}</b><span>${t.fromStationName} → ${t.toStationName}</span><time>${t.departTime}</time><em>检票口 ${t.gate || '-'} / 站台 ${t.platform || '-'}</em></div>`
      )
      .join('');
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#05152d;color:#fff;font-family:system-ui,"Microsoft YaHei";}
      .head{display:flex;justify-content:space-between;align-items:flex-end;padding:28px 42px;border-bottom:2px solid rgba(120,190,255,.3);}
      h1{margin:0;font-size:46px;letter-spacing:4px;} p{margin:6px 0 0;color:#8fb8e8}
      .clock{font-size:38px;font-variant-numeric:tabular-nums}
      .list{padding:18px 42px;display:grid;gap:10px}
      .row{display:grid;grid-template-columns:120px 1fr 110px 240px;align-items:center;padding:14px 18px;background:rgba(35,92,160,.28);border-left:4px solid #3f9cff;border-radius:8px;font-size:20px}
      .row b{font-size:26px;color:#7fd0ff} .row time{color:#ffd166;font-weight:700} .row em{font-style:normal;color:#9dc9ef;font-size:16px;text-align:right}
      .empty{padding:60px;text-align:center;color:#6f93b8}
    </style></head><body><div class="head"><div><h1>${station}</h1><p>今日车次 · 实时检票信息</p></div><div class="clock" id="clock"></div></div><div class="list">${rows || '<div class="empty">今日暂无车次</div>'}</div><script>function tick(){var d=new Date();var p=function(n){return String(n).padStart(2,"0")};document.getElementById("clock").textContent=p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds());}tick();setInterval(tick,1000);<\/script></body></html>`;
  });

  async function saveRule() {
    ruleSaving.value = true;
    try {
      await updateSettings({ checkinMinutes: Number(checkinMinutes.value) || 30 });
      message.success('开检提前时间已保存');
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      ruleSaving.value = false;
    }
  }

  onMounted(async () => {
    try {
      const [stationList, trainList, settings] = await Promise.all([getStationList(), getTrainList(), getSettings()]);
      stations.value = (stationList as StationItem[]) || [];
      trains.value = (trainList as TrainItem[]) || [];
      checkinMinutes.value = Number((settings as any)?.checkinMinutes || 30);
      screenStationId.value = stations.value[0]?.id || null;
    } catch (e) {
      /* ignore */
    }
    await loadMonitor();
    pollTimer.value = window.setInterval(loadMonitor, 15000);
    clockTimer = window.setInterval(() => {
      clock.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    }, 1000);
  });

  onBeforeUnmount(() => {
    if (ws.value) ws.value.close();
    if (pollTimer.value) window.clearInterval(pollTimer.value);
    if (clockTimer) window.clearInterval(clockTimer);
  });
</script>

<style lang="less" scoped>
  .stat-card {
    border-radius: 12px;
    padding: 16px 18px;
    background: linear-gradient(135deg, #f5f8ff, #eaf2ff);
    display: flex;
    flex-direction: column;
    gap: 8px;
    span { color: #6f7f95; font-size: 13px; }
    strong { font-size: 30px; color: #1b3f73; line-height: 1; }
  }
  .stat-card.is-green { background: linear-gradient(135deg, #f0fbf4, #e2f7ea); strong { color: #1d7a45; } }
  .stat-card.is-blue { background: linear-gradient(135deg, #eff8ff, #e0f1ff); strong { color: #0b5bb5; } }
  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .hint { color: #8a94a6; font-size: 12px; }
  .checkin-rule { display: flex; align-items: center; gap: 12px; padding: 10px 14px; margin-bottom: 12px; border-radius: 10px; background: #f6f9ff; color: #42526b; }
  .mb-4 { margin-bottom: 16px; }
  .mt-4 { margin-top: 16px; }

  .station-screen {
    border-radius: 18px;
    overflow: hidden;
    background: radial-gradient(circle at 20% 0%, #123a6d, #05152d 65%);
    color: #fff;
    padding: 0;
    box-shadow: 0 18px 48px rgba(8, 30, 60, 0.25);
  }
  .screen-head { display: flex; align-items: flex-end; justify-content: space-between; padding: 24px 30px; border-bottom: 1px solid rgba(120, 190, 255, 0.28);
    h1 { margin: 0; font-size: 34px; letter-spacing: 3px; }
    p { margin: 6px 0 0; font-size: 13px; color: #8fb8e8; }
  }
  .screen-clock { text-align: right; display: flex; flex-direction: column; gap: 4px;
    strong { font-size: 32px; font-variant-numeric: tabular-nums; }
    span { color: #8fb8e8; font-size: 12px; }
  }
  .screen-body { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 20px; padding: 20px 30px; }
  .screen-trains h2, .screen-side h2 { margin: 0 0 12px; font-size: 14px; color: #9dc9ef; letter-spacing: 2px; font-weight: 600; }
  .screen-train { display: grid; grid-template-columns: 110px minmax(0, 1fr) 100px 96px; gap: 12px; align-items: center; padding: 12px 16px; margin-bottom: 10px; border-radius: 8px; background: rgba(35, 92, 160, 0.26); border-left: 4px solid #3f9cff; }
  .train-no { font-size: 24px; font-weight: 700; color: #7fd0ff; }
  .train-route { display: flex; flex-direction: column; gap: 4px; strong { font-size: 15px; } span { font-size: 12px; color: #9dc9ef; } }
  .train-time { text-align: right; display: flex; flex-direction: column; gap: 3px; strong { font-size: 20px; color: #ffd166; font-variant-numeric: tabular-nums; } span { font-size: 11px; color: #8fb8e8; } }
  .train-state { text-align: right; display: flex; flex-direction: column; strong { font-size: 18px; } span { font-size: 11px; color: #8fb8e8; } }
  .train-state.hot strong { color: #63e6a4; }
  .screen-gates { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .screen-gate { padding: 10px; border-radius: 8px; background: rgba(46, 120, 200, 0.24); text-align: center; display: flex; flex-direction: column; gap: 2px; strong { font-size: 16px; color: #9fe6b4; } span { font-size: 11px; color: #8fb8e8; } }
  .screen-gate.off { background: rgba(200, 70, 70, 0.2); strong { color: #ffaea3; } }
  .screen-empty { color: #6f93b8; font-size: 12px; padding: 10px; }
  .screen-notice { margin-top: 18px; padding: 14px; border-radius: 10px; background: rgba(255, 255, 255, 0.06); }
  .screen-notice h3 { margin: 0 0 8px; font-size: 13px; color: #ffd166; }
  .screen-notice p { margin: 0; font-size: 12px; line-height: 1.8; color: #b8d2ec; }
  .screen-footer { display: block; padding: 12px 30px 18px; font-size: 11px; color: #6f93b8; }
  .screen-frame { width: 100%; height: 68vh; border: 0; border-radius: 10px; }
  @media (max-width: 900px) {
    .screen-body { grid-template-columns: 1fr; }
    .screen-train { grid-template-columns: 90px 1fr 80px; }
    .train-state { display: none; }
  }
</style>
