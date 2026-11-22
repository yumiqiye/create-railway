<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="总览">
        清江铁路12306 实时运营数据：城市 / 车站 / 车次规模、当日票额与售票情况、最新订单。
      </n-card>
    </div>

    <n-grid :cols="4" :x-gap="16" :y-gap="16" class="mt-4" responsive="screen" item-responsive>
      <n-gi span="4 s:2 m:1">
        <n-card :bordered="false" class="stat-card">
          <n-statistic label="开通城市" :value="stats.cityCount">
            <template #suffix>个</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="4 s:2 m:1">
        <n-card :bordered="false" class="stat-card">
          <n-statistic label="车站总数" :value="stats.stationCount">
            <template #suffix>个</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="4 s:2 m:1">
        <n-card :bordered="false" class="stat-card">
          <n-statistic label="在售车次" :value="stats.trainCount">
            <template #suffix>趟</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="4 s:2 m:1">
        <n-card :bordered="false" class="stat-card">
          <n-statistic label="累计订单" :value="stats.orderCount">
            <template #suffix>单</template>
          </n-statistic>
        </n-card>
      </n-gi>

      <n-gi span="4 s:2 m:1">
        <n-card :bordered="false" class="stat-card accent">
          <n-statistic label="票额合计" :value="stats.quota.seats">
            <template #suffix>张</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="4 s:2 m:1">
        <n-card :bordered="false" class="stat-card">
          <n-statistic label="已售车票" :value="stats.quota.sold">
            <template #suffix>张</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="4 s:2 m:1">
        <n-card :bordered="false" class="stat-card">
          <n-statistic label="余票" :value="stats.quota.remaining">
            <template #suffix>张</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="4 s:2 m:1">
        <n-card :bordered="false" class="stat-card">
          <n-statistic label="售票率" :value="stats.quota.utilization" :precision="1">
            <template #suffix>%</template>
          </n-statistic>
        </n-card>
      </n-gi>
    </n-grid>

    <n-card :bordered="false" class="mt-4" :title="`票额明细（${stats.date}）`">
      <template #header-extra>
        <n-space align="center">
          <n-date-picker v-model:formatted-value="date" value-format="yyyy-MM-dd" type="date" size="small" clearable />
          <n-button quaternary size="small" :loading="loading" @click="loadStats">刷新</n-button>
          <n-button v-if="hasPermission(['ticket_tickets'])" size="small" type="primary" ghost @click="goPage('ticket_tickets')">去设置票额</n-button>
        </n-space>
      </template>

      <n-data-table
        :columns="quotaColumns"
        :data="stats.trainQuotas"
        :loading="loading"
        :row-key="(row: TicketRow) => row.trainId"
        :bordered="false"
        :single-line="false"
        :pagination="false"
      />
    </n-card>

    <n-card :bordered="false" class="mt-4" title="最新订单">
      <template #header-extra>
        <n-space>
          <n-button quaternary size="small" :loading="loading" @click="loadStats">刷新</n-button>
          <n-button size="small" type="primary" ghost @click="goOrders">全部订单</n-button>
        </n-space>
      </template>

      <n-data-table
        :columns="columns"
        :data="stats.recentOrders"
        :loading="loading"
        :row-key="(row: OrderItem) => row.id"
        :bordered="false"
        :single-line="false"
        :pagination="false"
      />

      <div class="shortcuts">
        <n-button @click="goPage('ticket_cities')">城市管理</n-button>
        <n-button @click="goPage('ticket_stations')">车站管理</n-button>
        <n-button @click="goPage('ticket_trains')">车次管理</n-button>
        <n-button @click="goPage('ticket_settings')">系统设置</n-button>
        <n-button type="primary" ghost @click="openFrontend">打开前台购票页</n-button>
        <n-button type="primary" ghost @click="openScreen">打开候车大屏</n-button>
      </div>
    </n-card>
  </div>
</template>

<script lang="ts" setup>
  import { h, onMounted, reactive, ref } from 'vue';
  import { NTag, useMessage } from 'naive-ui';
  import type { DataTableColumns } from 'naive-ui';
  import { useRouter } from 'vue-router';
  import { getRuntimeConfig, getStats, type OrderItem, type StatsResult, type TicketRow } from '@/api/ticket';
  import { usePermission } from '@/hooks/web/usePermission';

  const { hasPermission } = usePermission();

  const message = useMessage();
  const router = useRouter();
  const loading = ref(false);
  const frontendUrl = ref('http://localhost:3000');

  const pad = (n: number) => String(n).padStart(2, '0');
  const today = new Date();
  const date = ref(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);

  const stats = reactive<StatsResult>({
    date: '',
    cityCount: 0,
    stationCount: 0,
    trainCount: 0,
    orderCount: 0,
    paidOrderCount: 0,
    todayOrderCount: 0,
    ticketCount: 0,
    todayTicketCount: 0,
    revenue: 0,
    todayRevenue: 0,
    quota: { seats: 0, sold: 0, remaining: 0, utilization: 0 },
    seatTypes: [],
    trainQuotas: [],
    recentOrders: [],
  });

  const statusText = (s: string) => ({ pending: '待支付', paid: '已支付', refunded: '已退票', canceled: '已取消' }[s] || s);
  const statusType = (s: string) =>
    ({ paid: 'success', refunded: 'warning', canceled: 'default' }[s] || 'default') as any;

  const quotaColumns: DataTableColumns<TicketRow> = [
    {
      title: '车次',
      key: 'trainNo',
      width: 100,
      render: (row) =>
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [
          h('span', { style: 'color:#1b64c4;font-weight:600' }, row.trainNo),
          h('span', { style: 'color:#9aa3b2;font-size:12px' }, row.type),
        ]),
    },
    {
      title: '行程',
      key: 'route',
      minWidth: 200,
      render: (row) =>
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [
          h('span', {}, `${row.fromStationName} → ${row.toStationName}`),
          h('span', { style: 'color:#9aa3b2;font-size:12px' }, `${row.departTime} 开 · ${row.arriveTime} 到`),
        ]),
    },
    { title: '票额', key: 'quota', width: 70 },
    { title: '已售', key: 'sold', width: 70 },
    {
      title: '余票',
      key: 'remaining',
      width: 70,
      render: (row) => h('span', { style: row.remaining === 0 ? 'color:#c9ced8' : 'color:#d9363e;font-weight:600' }, String(row.remaining)),
    },
    {
      title: '席别票额（票额 / 已售 / 余票）',
      key: 'seats',
      minWidth: 270,
      render: (row) =>
        h(
          'div',
          { style: 'display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:1.6' },
          (row.seats || []).map((s) =>
            h('div', { style: 'display:flex;gap:10px' }, [
              h('span', { style: 'color:#6b7280;width:48px' }, s.type),
              h('span', { style: 'width:52px' }, `${s.quota} 张`),
              h('span', { style: 'color:#9aa3b2;width:56px' }, `已售 ${s.sold}`),
              h('span', { style: 'color:#d9363e;width:56px' }, `余 ${s.remaining}`),
            ])
          )
        ),
    },
  ];

  const columns: DataTableColumns<OrderItem> = [
    { title: '订单号', key: 'orderNo', width: 185 },
    {
      title: '车次行程',
      key: 'route',
      minWidth: 200,
      render: (row) =>
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [
          h('div', {}, `${row.trainNo}　${row.route?.fromStationName || '-'} → ${row.route?.toStationName || '-'}`),
          h('span', { style: 'color:#9aa3b2;font-size:12px' }, `${row.date} · ${row.seatType}`),
        ]),
    },
    {
      title: '乘客',
      key: 'passengers',
      minWidth: 140,
      render: (row) => (row.passengers || []).map((p) => p.name).join('、'),
    },
    { title: '金额', key: 'totalPrice', width: 85, render: (row) => `¥${row.totalPrice}` },
    {
      title: '状态',
      key: 'status',
      width: 85,
      render: (row) =>
        h(NTag, { size: 'small', bordered: false, type: statusType(row.status) }, { default: () => statusText(row.status) }),
    },
  ];

  async function loadStats() {
    loading.value = true;
    try {
      const data = (await getStats({ date: date.value || undefined })) as StatsResult;
      Object.assign(stats, data);
      date.value = data.date;
    } catch (e: any) {
      message.error(e.message || '统计数据加载失败');
    } finally {
      loading.value = false;
    }
  }

  function goPage(name: string) {
    router.push({ name });
  }

  function goOrders() {
    router.push({ name: 'ticket_orders' });
  }

  function openFrontend() {
    window.open(frontendUrl.value, '_blank');
  }

  function openScreen() {
    window.open(`${frontendUrl.value.replace(/\/$/, '')}/screen.html`, '_blank');
  }

  async function loadRuntimeConfig() {
    try {
      const cfg = await getRuntimeConfig();
      if (cfg && cfg.urls && cfg.urls.ticket) frontendUrl.value = cfg.urls.ticket;
    } catch (e) {
      /* 保留默认地址 */
    }
  }

  onMounted(() => {
    loadRuntimeConfig();
    loadStats();
  });
</script>

<style lang="less" scoped>
  .stat-card {
    border-radius: 8px;
    background: #fff;
  }

  .stat-card.accent :deep(.n-statistic-value__content) {
    color: #d9363e;
  }

  .shortcuts {
    margin-top: 18px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
</style>
