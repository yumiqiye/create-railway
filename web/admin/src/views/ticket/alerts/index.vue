<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="告警中心">
        闸机离线、配置下发失败、配置长时间未确认和检票异常会在这里汇总；处理后仍保留历史记录。
      </n-card>
    </div>

    <n-grid :cols="4" :x-gap="16" :y-gap="16" class="mt-4" responsive="screen" item-responsive>
      <n-gi span="4 s:2 m:1">
        <n-card :bordered="false" class="stat-card danger">
          <n-statistic label="未处理" :value="summary.open">
            <template #suffix>条</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="4 s:2 m:1">
        <n-card :bordered="false" class="stat-card warning">
          <n-statistic label="严重告警" :value="summary.critical">
            <template #suffix>条</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="4 s:2 m:1">
        <n-card :bordered="false" class="stat-card">
          <n-statistic label="一般警告" :value="summary.warn">
            <template #suffix>条</template>
          </n-statistic>
        </n-card>
      </n-gi>
      <n-gi span="4 s:2 m:1">
        <n-card :bordered="false" class="stat-card ok">
          <n-statistic label="已确认" :value="summary.ack">
            <template #suffix>条</template>
          </n-statistic>
        </n-card>
      </n-gi>
    </n-grid>

    <n-card :bordered="false" class="mt-4">
      <div class="toolbar">
        <n-space align="center">
          <n-input
            v-model:value="keyword"
            placeholder="搜索标题 / 详情 / 闸机"
            clearable
            style="width: 240px"
            @keyup.enter="load"
          />
          <n-select v-model:value="level" :options="levelOptions" placeholder="全部级别" clearable style="width: 130px" @update:value="load" />
          <n-select v-model:value="status" :options="statusOptions" placeholder="全部状态" clearable style="width: 140px" @update:value="load" />
        </n-space>
        <n-space>
          <n-tag :bordered="false">共 {{ total }} 条</n-tag>
          <n-switch v-model:value="soundOn" size="small" @update:value="toggleSound" />
          <span class="sound-label">声音提醒</span>
          <n-button size="small" quaternary :loading="loading" @click="load">刷新</n-button>
        </n-space>
      </div>

      <n-data-table
        :columns="columns"
        :data="rows"
        :loading="loading"
        :row-key="(row: AlertItem) => row.id"
        :pagination="pagination"
        :bordered="false"
        :single-line="false"
        :max-height="620"
      />
    </n-card>
  </div>
</template>

<script lang="ts" setup>
  import { h, onMounted, onUnmounted, reactive, ref } from 'vue';
  import { NButton, NTag, useMessage } from 'naive-ui';
  import type { DataTableColumns, SelectOption } from 'naive-ui';
  import { getAlertList, updateAlert, type AlertItem, type AlertSummary } from '@/api/ticket';

  const message = useMessage();
  const loading = ref(false);
  const rows = ref<AlertItem[]>([]);
  const total = ref(0);
  const status = ref<string | null>('pending');
  const level = ref<string | null>(null);
  const keyword = ref('');
  const page = ref(1);
  const pageSize = ref(20);
  const soundOn = ref(false);
  const summary = reactive<AlertSummary>({ open: 0, ack: 0, ignored: 0, resolved: 0, critical: 0, warn: 0 });
  let timer: number | null = null;
  let audioCtx: AudioContext | null = null;
  let lastOpen = 0;

  const statusOptions: SelectOption[] = [
    { label: '待处理', value: 'pending' },
    { label: '未确认', value: 'open' },
    { label: '已确认', value: 'ack' },
    { label: '已忽略', value: 'ignored' },
    { label: '已解决', value: 'resolved' },
    { label: '全部', value: 'all' },
  ];
  const levelOptions: SelectOption[] = [
    { label: '严重', value: 'error' },
    { label: '警告', value: 'warn' },
    { label: '提示', value: 'info' },
  ];

  const statusText: Record<string, string> = { open: '未确认', ack: '已确认', ignored: '已忽略', resolved: '已解决' };
  const statusType: Record<string, 'error' | 'warning' | 'success' | 'default'> = {
    open: 'error',
    ack: 'warning',
    ignored: 'default',
    resolved: 'success',
  };
  const levelType: Record<string, 'error' | 'warning' | 'info'> = { error: 'error', warn: 'warning', info: 'info' };

  function fmtTime(value?: string) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function targetText(row: AlertItem) {
    const target = String(row.target || '');
    return target.includes('::') ? target.split('::').pop() || target : target;
  }

  function beep() {
    try {
      audioCtx = audioCtx || new AudioContext();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.18);
    } catch (e) {
      /* 浏览器限制自动播放时忽略 */
    }
  }

  function toggleSound(value: boolean) {
    if (value) {
      try {
        audioCtx = audioCtx || new AudioContext();
        audioCtx.resume();
        beep();
      } catch (e) { /* ignore */ }
    }
  }

  async function load() {
    loading.value = true;
    try {
      const data = await getAlertList({
        status: status.value || '',
        level: level.value || '',
        keyword: keyword.value.trim(),
        page: page.value,
        pageSize: pageSize.value,
      });
      rows.value = data.rows || [];
      total.value = data.total || 0;
      Object.assign(summary, data.summary || {});
      if (soundOn.value && summary.open > lastOpen) beep();
      lastOpen = summary.open;
      pagination.page = page.value;
      pagination.pageSize = pageSize.value;
    } catch (e: any) {
      message.error(e?.message || '告警加载失败');
    } finally {
      loading.value = false;
    }
  }

  async function act(row: AlertItem, action: 'ack' | 'ignore' | 'resolve') {
    try {
      await updateAlert(row.id, action);
      message.success(action === 'ack' ? '告警已确认' : action === 'ignore' ? '告警已忽略' : '告警已解决');
      await load();
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  }

  const columns: DataTableColumns<AlertItem> = [
    { title: '时间', key: 'lastAt', width: 165, render: (row) => fmtTime(row.lastAt || row.at) },
    {
      title: '级别',
      key: 'level',
      width: 80,
      render: (row) => h(NTag, { size: 'small', type: levelType[row.level] || 'info' }, { default: () => (row.level === 'error' ? '严重' : row.level === 'warn' ? '警告' : '提示') }),
    },
    {
      title: '告警',
      key: 'title',
      minWidth: 300,
      render: (row) =>
        h('div', { class: 'alert-main' }, [
          h('div', { class: 'alert-title' }, `${row.title || row.type}${row.count > 1 ? ` ×${row.count}` : ''}`),
          h('div', { class: 'alert-detail' }, row.detail || ''),
          h('div', { class: 'alert-meta' }, `${targetText(row)}${row.source ? ' · ' + row.source : ''}${row.ackedBy ? ' · ' + row.ackedBy : ''}`),
        ]),
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (row) => h(NTag, { size: 'small', type: statusType[row.status] || 'default' }, { default: () => statusText[row.status] || row.status }),
    },
    {
      title: '操作',
      key: 'action',
      width: 190,
      render: (row) =>
        h('div', { class: 'alert-actions' }, [
          h(
            NButton,
            { size: 'tiny', type: 'primary', quaternary: true, disabled: row.status !== 'open', onClick: () => act(row, 'ack') },
            { default: () => '确认' }
          ),
          h(
            NButton,
            { size: 'tiny', quaternary: true, disabled: row.status === 'resolved' || row.status === 'ignored', onClick: () => act(row, 'ignore') },
            { default: () => '忽略' }
          ),
          h(
            NButton,
            { size: 'tiny', type: 'success', quaternary: true, disabled: row.status === 'resolved', onClick: () => act(row, 'resolve') },
            { default: () => '解决' }
          ),
        ]),
    },
  ];

  const pagination = reactive({
    page: 1,
    pageSize: 20,
    showSizePicker: true,
    pageSizes: [20, 50, 100],
    onChange: (p: number) => {
      page.value = p;
      load();
    },
    onUpdatePageSize: (size: number) => {
      pageSize.value = size;
      page.value = 1;
      load();
    },
  }) as any;

  onMounted(() => {
    load();
    timer = window.setInterval(load, 10000);
  });
  onUnmounted(() => {
    if (timer) window.clearInterval(timer);
  });
</script>

<style scoped>
  .stat-card.danger :deep(.n-statistic-value) {
    color: #d03050;
  }
  .stat-card.warning :deep(.n-statistic-value) {
    color: #f0a020;
  }
  .stat-card.ok :deep(.n-statistic-value) {
    color: #18a058;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }
  .sound-label {
    font-size: 12px;
    color: #666;
  }
  .alert-title {
    font-weight: 600;
    color: #1b64c4;
  }
  .alert-detail {
    font-size: 12px;
    color: #555;
    margin-top: 2px;
    white-space: normal;
  }
  .alert-meta {
    font-size: 11px;
    color: #999;
    margin-top: 2px;
  }
  .alert-actions {
    display: flex;
    gap: 4px;
  }
</style>
