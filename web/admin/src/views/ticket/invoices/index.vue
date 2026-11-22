<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="发票管理">
        旅客在前台购票后可申请电子发票；订单退票时系统自动红冲对应发票，已红冲的发票不能再次下载。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4">
      <div class="toolbar">
        <n-space align="center">
          <n-input v-model:value="keyword" placeholder="搜索订单号 / 车次 / 发票号 / 手机号" clearable style="width: 280px" />
          <n-select v-model:value="status" :options="statusOptions" placeholder="全部状态" clearable style="width: 150px" />
        </n-space>
        <n-space>
          <n-tag :bordered="false">共 {{ rows.length }} 张</n-tag>
          <n-button size="small" quaternary :loading="loading" @click="load">刷新</n-button>
        </n-space>
      </div>

      <n-data-table
        :columns="columns"
        :data="filteredRows"
        :loading="loading"
        :row-key="(row: OrderItem) => row.id"
        :bordered="false"
        :single-line="false"
        :max-height="620"
      />
    </n-card>
  </div>
</template>

<script lang="ts" setup>
  import { computed, h, onMounted, ref } from 'vue';
  import { NTag, useDialog, useMessage } from 'naive-ui';
  import type { DataTableColumns, SelectOption } from 'naive-ui';
  import { getInvoiceList, redFlushInvoice, type OrderItem } from '@/api/ticket';

  const message = useMessage();
  const dialog = useDialog();
  const loading = ref(false);
  const rows = ref<OrderItem[]>([]);
  const keyword = ref('');
  const status = ref<string | null>(null);

  const statusOptions: SelectOption[] = [
    { label: '已开具', value: 'issued' },
    { label: '已红冲', value: 'redFlushed' },
  ];

  const statusText: Record<string, string> = { issued: '已开具', redFlushed: '已红冲' };
  const statusType: Record<string, 'success' | 'error'> = { issued: 'success', redFlushed: 'error' };
  const orderStatusText: Record<string, string> = { paid: '已支付', refunded: '已退票', canceled: '已取消' };

  const filteredRows = computed(() => {
    const kw = keyword.value.trim().toLowerCase();
    return rows.value.filter((row) => {
      if (status.value && (row.invoiceStatus || 'issued') !== status.value) return false;
      if (!kw) return true;
      return [row.orderNo, row.trainNo, row.invoiceNo, row.contactPhone, row.route?.fromStationName, row.route?.toStationName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(kw);
    });
  });

  const columns: DataTableColumns<OrderItem> = [
    { title: '订单号', key: 'orderNo', width: 190 },
    {
      title: '车次 / 区间',
      key: 'train',
      minWidth: 190,
      render: (row) =>
        `${row.trainNo} ${row.route ? `${row.route.fromStationName}→${row.route.toStationName}` : ''}`,
    },
    { title: '乘车日期', key: 'date', width: 110 },
    {
      title: '金额',
      key: 'totalPrice',
      width: 90,
      render: (row) => `¥${Number(row.totalPrice || 0).toFixed(2)}`,
    },
    { title: '发票号码', key: 'invoiceNo', width: 180 },
    { title: '抬头', key: 'invoiceTitle', width: 120, render: (row) => row.invoiceTitle || '个人' },
    {
      title: '发票状态',
      key: 'invoiceStatus',
      width: 100,
      render: (row) => {
        const value = row.invoiceStatus || 'issued';
        return h(NTag, { size: 'small', type: statusType[value] || 'default', bordered: false }, {
          default: () => statusText[value] || value,
        });
      },
    },
    {
      title: '订单状态',
      key: 'status',
      width: 100,
      render: (row) => orderStatusText[row.status] || row.status,
    },
    {
      title: '开具时间',
      key: 'invoiceIssuedAt',
      width: 170,
      render: (row) => (row.invoiceIssuedAt ? new Date(row.invoiceIssuedAt).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (row) => {
        if ((row.invoiceStatus || 'issued') === 'redFlushed') {
          return h('span', { style: 'color:#999' }, '已红冲');
        }
        if (row.status !== 'refunded') {
          return h('span', { style: 'color:#999' }, '退票后可红冲');
        }
        return h(
          'a',
          {
            style: 'color:#d03050;cursor:pointer',
            onClick: () => confirmRedFlush(row),
          },
          '红冲'
        );
      },
    },
  ];

  function confirmRedFlush(row: OrderItem) {
    dialog.warning({
      title: '确认红冲发票',
      content: `订单 ${row.orderNo} 已退票，红冲后发票 ${row.invoiceNo || ''} 将失效，确定继续吗？`,
      positiveText: '确认红冲',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await redFlushInvoice(row.orderNo, '后台手动红冲');
          message.success('发票已红冲');
          await load();
        } catch (e: any) {
          message.error(e.message || '红冲失败');
        }
      },
    });
  }

  async function load() {
    loading.value = true;
    try {
      rows.value = (await getInvoiceList()) as OrderItem[];
    } catch (e: any) {
      message.error(e.message || '发票加载失败');
    } finally {
      loading.value = false;
    }
  }

  onMounted(load);
</script>

<style lang="less" scoped>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .mt-4 {
    margin-top: 16px;
  }
</style>
