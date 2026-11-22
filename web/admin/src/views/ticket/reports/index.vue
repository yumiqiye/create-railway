<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="运营报表">
        按乘车日期统计售票、退票、净收入和检票完成率，可下钻到车站、车次、席别和购票渠道。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4">
      <div class="toolbar">
        <n-space align="center">
          <span class="label">统计区间</span>
          <n-date-picker v-model:formatted-value="from" value-format="yyyy-MM-dd" type="date" size="small" />
          <span class="label">至</span>
          <n-date-picker v-model:formatted-value="to" value-format="yyyy-MM-dd" type="date" size="small" />
          <n-button size="small" type="primary" :loading="loading" @click="load">查询</n-button>
          <n-button size="small" quaternary :disabled="!report" @click="exportCsv">导出 CSV</n-button>
        </n-space>
        <n-space>
          <n-button size="small" quaternary @click="openScreen">打开候车大屏</n-button>
          <n-tag :bordered="false">{{ report?.from || '-' }} ~ {{ report?.to || '-' }}</n-tag>
        </n-space>
      </div>

      <n-grid :cols="4" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
        <n-gi span="4 s:2 m:1">
          <n-card :bordered="false" class="stat-card">
            <n-statistic label="售票张数" :value="summary.validTickets"><template #suffix>张</template></n-statistic>
            <div class="sub">含退票 {{ summary.refundTickets }} 张 · 共 {{ summary.orders }} 单</div>
          </n-card>
        </n-gi>
        <n-gi span="4 s:2 m:1">
          <n-card :bordered="false" class="stat-card accent">
            <n-statistic label="售票收入" :value="summary.grossRevenue" :precision="2"><template #prefix>¥</template></n-statistic>
            <div class="sub">有效收入 ¥{{ money(summary.validRevenue) }}</div>
          </n-card>
        </n-gi>
        <n-gi span="4 s:2 m:1">
          <n-card :bordered="false" class="stat-card warning">
            <n-statistic label="退票金额" :value="summary.refundAmount" :precision="2"><template #prefix>¥</template></n-statistic>
            <div class="sub">净收入 ¥{{ money(summary.netRevenue) }}</div>
          </n-card>
        </n-gi>
        <n-gi span="4 s:2 m:1">
          <n-card :bordered="false" class="stat-card ok">
            <n-statistic label="检票完成率" :value="summary.checkinRate" :precision="1"><template #suffix>%</template></n-statistic>
            <div class="sub">已检 {{ summary.checkedPassengers }} / 有效票 {{ summary.validTickets }}</div>
          </n-card>
        </n-gi>
      </n-grid>

      <div class="secondary">
        <n-tag :bordered="false">车次 {{ summary.trainCount }}</n-tag>
        <n-tag :bordered="false">车站 {{ summary.stationCount }}</n-tag>
        <n-tag :bordered="false">客单价 ¥{{ money(summary.avgTicketPrice) }}</n-tag>
        <n-tag :bordered="false">退票单 {{ summary.refundOrders }}</n-tag>
        <n-tag :bordered="false">取消单 {{ summary.canceledOrders }}</n-tag>
      </div>
    </n-card>

    <n-card :bordered="false" class="mt-4" title="每日净收入">
      <div v-if="dailyRows.length" class="bars">
        <div v-for="row in dailyRows" :key="row.date" class="bar-row">
          <span class="bar-date">{{ row.date.slice(5) }}</span>
          <div class="bar-track">
            <div class="bar-fill" :style="{ width: barWidth(row.netRevenue) }"></div>
          </div>
          <span class="bar-value">¥{{ money(row.netRevenue) }}</span>
          <span class="bar-extra">售 {{ row.validTickets }} · 检 {{ row.checkedPassengers }}</span>
        </div>
      </div>
      <n-empty v-else description="当前区间没有数据" />
    </n-card>

    <n-card :bordered="false" class="mt-4" title="每日明细">
      <n-data-table
        :columns="dailyColumns"
        :data="dailyRows"
        :bordered="false"
        :single-line="false"
        :pagination="false"
        :max-height="420"
      />
    </n-card>

    <n-grid :cols="2" :x-gap="16" :y-gap="16" class="mt-4" responsive="screen" item-responsive>
      <n-gi span="2 m:1">
        <n-card :bordered="false" title="车站销售">
          <n-data-table :columns="stationColumns" :data="report?.stations || []" :bordered="false" :single-line="false" :pagination="false" :max-height="480" />
        </n-card>
      </n-gi>
      <n-gi span="2 m:1">
        <n-card :bordered="false" title="车次销售">
          <n-data-table :columns="trainColumns" :data="report?.trains || []" :bordered="false" :single-line="false" :pagination="false" :max-height="480" />
        </n-card>
      </n-gi>
      <n-gi span="2 m:1">
        <n-card :bordered="false" title="席别结构">
          <n-data-table :columns="groupColumns" :data="report?.seatTypes || []" :bordered="false" :single-line="false" :pagination="false" :max-height="420" />
        </n-card>
      </n-gi>
      <n-gi span="2 m:1">
        <n-card :bordered="false" title="购票渠道">
          <n-data-table :columns="groupColumns" :data="report?.channels || []" :bordered="false" :single-line="false" :pagination="false" :max-height="420" />
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>

<script lang="ts" setup>
  import { computed, h, onMounted, reactive, ref } from 'vue';
  import { useMessage } from 'naive-ui';
  import type { DataTableColumns } from 'naive-ui';
  import {
    getOperationsReport,
    getRuntimeConfig,
    type OperationsReport,
    type ReportDailyRow,
    type ReportGroupRow,
    type ReportSummary,
  } from '@/api/ticket';

  const message = useMessage();
  const loading = ref(false);
  const report = ref<OperationsReport | null>(null);
  const frontendUrl = ref('http://localhost:3000');

  const pad = (n: number) => String(n).padStart(2, '0');
  const d = new Date();
  const to = ref(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  const before = new Date();
  before.setDate(before.getDate() - 6);
  const from = ref(`${before.getFullYear()}-${pad(before.getMonth() + 1)}-${pad(before.getDate())}`);

  const summary = reactive<ReportSummary>({
    orders: 0,
    paidOrders: 0,
    refundOrders: 0,
    canceledOrders: 0,
    ticketsSold: 0,
    validTickets: 0,
    refundTickets: 0,
    grossRevenue: 0,
    validRevenue: 0,
    refundAmount: 0,
    netRevenue: 0,
    checkedPassengers: 0,
    checkinRate: 0,
    avgTicketPrice: 0,
    trainCount: 0,
    stationCount: 0,
  });

  const dailyRows = computed<ReportDailyRow[]>(() => report.value?.daily || []);
  const barMax = computed(() => Math.max(1, ...dailyRows.value.map((r) => r.netRevenue)));

  function money(value: number) {
    return Number(value || 0).toFixed(2);
  }
  function barWidth(value: number) {
    return `${Math.max(2, (Number(value || 0) / barMax.value) * 100)}%`;
  }

  async function load() {
    if (from.value > to.value) {
      message.warning('开始日期不能晚于结束日期');
      return;
    }
    loading.value = true;
    try {
      const data = await getOperationsReport({ from: from.value, to: to.value });
      report.value = data;
      Object.assign(summary, data.summary || {});
    } catch (e: any) {
      message.error(e?.message || '报表加载失败');
    } finally {
      loading.value = false;
    }
  }

  function openScreen() {
    window.open(`${frontendUrl.value.replace(/\/$/, '')}/screen.html`, '_blank');
  }

  function exportCsv() {
    if (!report.value) return;
    const rows: string[][] = [
      ['日期', '订单', '有效票', '退票', '售票收入', '退票金额', '净收入', '已检', '检票率'],
      ...dailyRows.value.map((r) => [
        r.date,
        String(r.orders),
        String(r.validTickets),
        String(r.refundTickets),
        money(r.grossRevenue),
        money(r.refundAmount),
        money(r.netRevenue),
        String(r.checkedPassengers),
        `${r.checkinRate}%`,
      ]),
    ];
    const csv = '\ufeff' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `运营报表_${report.value.from}_${report.value.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const dailyColumns: DataTableColumns<ReportDailyRow> = [
    { title: '日期', key: 'date', width: 110 },
    { title: '订单', key: 'orders', width: 70 },
    { title: '有效票', key: 'validTickets', width: 80 },
    { title: '退票', key: 'refundTickets', width: 70 },
    { title: '售票收入', key: 'grossRevenue', render: (r) => `¥${money(r.grossRevenue)}` },
    { title: '退票金额', key: 'refundAmount', render: (r) => `¥${money(r.refundAmount)}` },
    { title: '净收入', key: 'netRevenue', render: (r) => `¥${money(r.netRevenue)}` },
    { title: '已检', key: 'checkedPassengers', width: 70 },
    {
      title: '检票率',
      key: 'checkinRate',
      width: 90,
      render: (r) => h('span', { class: `rate ${r.checkinRate >= 80 ? 'good' : r.checkinRate >= 50 ? 'mid' : 'low'}` }, `${r.checkinRate}%`),
    },
  ];

  const stationColumns: DataTableColumns<ReportGroupRow> = [
    { title: '车站', key: 'label' },
    { title: '订单', key: 'orders', width: 70 },
    { title: '有效票', key: 'validTickets', width: 80 },
    { title: '退票', key: 'refundTickets', width: 70 },
    { title: '收入', key: 'grossRevenue', render: (r) => `¥${money(r.grossRevenue)}` },
    { title: '已检', key: 'checkedPassengers', width: 70 },
  ];
  const trainColumns: DataTableColumns<ReportGroupRow> = [
    { title: '车次', key: 'label', width: 90 },
    { title: '区段', key: 'route', minWidth: 160, render: (r) => `${r.fromStationName || ''} → ${r.toStationName || ''}` },
    { title: '开点', key: 'departTime', width: 70 },
    { title: '有效票', key: 'validTickets', width: 80 },
    { title: '收入', key: 'grossRevenue', render: (r) => `¥${money(r.grossRevenue)}` },
    { title: '已检', key: 'checkedPassengers', width: 70 },
  ];
  const groupColumns: DataTableColumns<ReportGroupRow> = [
    { title: '分类', key: 'label' },
    { title: '订单', key: 'orders', width: 70 },
    { title: '有效票', key: 'validTickets', width: 80 },
    { title: '退票', key: 'refundTickets', width: 70 },
    { title: '收入', key: 'grossRevenue', render: (r) => `¥${money(r.grossRevenue)}` },
    { title: '检票率', key: 'checkinRate', width: 90, render: (r) => `${r.checkinRate}%` },
  ];

  onMounted(async () => {
    try {
      const cfg = await getRuntimeConfig();
      if (cfg?.urls?.ticket) frontendUrl.value = cfg.urls.ticket;
    } catch (e) { /* ignore */ }
    load();
  });
</script>

<style scoped>
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .label {
    font-size: 12px;
    color: #666;
  }
  .sub {
    font-size: 12px;
    color: #888;
    margin-top: 4px;
  }
  .secondary {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 14px;
  }
  .stat-card.accent :deep(.n-statistic-value) {
    color: #1b64c4;
  }
  .stat-card.warning :deep(.n-statistic-value) {
    color: #f0a020;
  }
  .stat-card.ok :deep(.n-statistic-value) {
    color: #18a058;
  }
  .bars {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .bar-row {
    display: grid;
    grid-template-columns: 54px 1fr 120px 150px;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: #555;
  }
  .bar-date {
    color: #888;
  }
  .bar-track {
    height: 16px;
    background: #f1f4f8;
    border-radius: 8px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    min-width: 2px;
    background: linear-gradient(90deg, #1b64c4, #49a3ff);
    border-radius: 8px;
    transition: width 0.3s;
  }
  .bar-value {
    text-align: right;
    font-weight: 600;
    color: #1b64c4;
  }
  .bar-extra {
    color: #999;
  }
  .rate.good {
    color: #18a058;
    font-weight: 600;
  }
  .rate.mid {
    color: #f0a020;
    font-weight: 600;
  }
  .rate.low {
    color: #d03050;
    font-weight: 600;
  }
</style>
