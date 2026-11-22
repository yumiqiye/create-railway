<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="车票管理">
        按乘车日期维护每个车次各席别的可售票额。未单独设置的日期默认取「车次管理」里配置的定员；票额不能小于该日已售张数。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4">
      <div class="toolbar">
        <n-date-picker v-model:formatted-value="date" value-format="yyyy-MM-dd" type="date" clearable placeholder="选择乘车日期" style="width: 180px" @update:formatted-value="loadData" />
        <n-input v-model:value="keyword" placeholder="搜索车次号 / 车站" clearable style="width: 240px" @keyup.enter="loadData" />
        <n-button type="primary" ghost @click="loadData">查询</n-button>
        <n-button quaternary @click="resetFilter">重置</n-button>
        <n-button quaternary :loading="loading" @click="loadData">刷新</n-button>
      </div>

      <div v-if="rows.length" class="ticket-grid">
        <div v-for="row in rows" :key="row.trainId" class="ticket-card">
          <div class="tk-head">
            <div class="tk-title">
              <span class="tk-no">{{ row.trainNo }}</span>
              <span class="tk-type">{{ row.type }}</span>
            </div>
            <n-button size="small" secondary type="primary" @click="openEdit(row)">编辑票额</n-button>
          </div>
          <div class="tk-route">{{ row.fromStationName }} → {{ row.toStationName }}</div>
          <div class="tk-time">{{ row.date }} · {{ row.departTime }} 开 · {{ row.arriveTime }} 到</div>
          <div class="tk-seats">
            <div v-for="s in row.seats" :key="s.type" class="tk-seat-row">
              <b>{{ s.type }}</b>
              <span class="tk-metric">票额 <i>{{ s.quota }}</i></span>
              <span class="tk-metric">已售 <i>{{ s.sold }}</i></span>
              <span class="tk-metric">余票 <i :class="{ zero: s.remaining === 0 }">{{ s.remaining }}</i></span>
            </div>
          </div>
          <div class="tk-foot">
            <span>总票额 <b>{{ row.quota }}</b> 张</span>
            <span>余票 <b class="remain">{{ row.remaining }}</b> 张</span>
          </div>
        </div>
      </div>
      <n-empty v-else description="该日期暂无可售票额" style="padding: 40px 0" />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" style="width: 720px" :title="`设置票额 · ${editing?.trainNo || ''}`">
      <div v-if="editing" class="edit-body">
        <div class="edit-head">
          <span>{{ editing.fromStationName }} → {{ editing.toStationName }}</span>
          <span class="muted">{{ editing.date }} · {{ editing.departTime }} 开</span>
        </div>
        <n-data-table :columns="editColumns" :data="editRows" :bordered="false" :single-line="false" :pagination="false" />
        <div class="edit-tip">提示：票额为 0 表示该席别当日停售；已售张数由已支付订单实时统计，不可改小到低于已售。</div>
      </div>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="saveQuota">保存票额</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script lang="ts" setup>
  import { h, onMounted, ref } from 'vue';
  import { NButton, NInputNumber, NTag, useMessage } from 'naive-ui';
  import type { DataTableColumns } from 'naive-ui';
  import { getTicketList, saveTrainQuota, type TicketRow, type TicketSeatItem } from '@/api/ticket';

  const message = useMessage();
  const loading = ref(false);
  const saving = ref(false);
  const rows = ref<TicketRow[]>([]);
  const date = ref<string | null>(null);
  const keyword = ref('');

  const pad = (n: number) => String(n).padStart(2, '0');
  const today = new Date();
  const defaultDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  date.value = defaultDate;

  const columns: DataTableColumns<TicketRow> = [
    {
      title: '车次',
      key: 'trainNo',
      width: 100,
      render: (row) =>
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [
          h('span', { style: 'color:#1b64c4;font-weight:600;font-size:15px' }, row.trainNo),
          h('span', { style: 'color:#9aa3b2;font-size:12px' }, row.type),
        ]),
    },
    {
      title: '行程',
      key: 'route',
      minWidth: 185,
      render: (row) =>
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [
          h('span', {}, `${row.fromStationName} → ${row.toStationName}`),
          h('span', { style: 'color:#9aa3b2;font-size:12px' }, `${row.departTime} 开 · ${row.arriveTime} 到`),
        ]),
    },
    {
      title: '席别票额（票额/已售/余票）',
      key: 'seats',
      minWidth: 230,
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
    { title: '票额', key: 'quota', width: 70 },
    { title: '余票', key: 'remaining', width: 70 },
    {
      title: '操作',
      key: 'action',
      width: 95,
      render: (row) =>
        h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑票额' }),
    },
  ];

  const editing = ref<TicketRow | null>(null);
  const editRows = ref<{ type: string; capacity: number; sold: number; quota: number; remaining: number }[]>([]);
  const showEdit = ref(false);

  const editColumns: DataTableColumns<any> = [
    { title: '席别', key: 'type', width: 110 },
    { title: '定员', key: 'capacity', width: 90 },
    { title: '已售', key: 'sold', width: 90 },
    {
      title: '可售票额',
      key: 'quota',
      width: 180,
      render: (row, index) =>
        h(NInputNumber, {
          value: row.quota,
          min: row.sold,
          max: 9999,
          precision: 0,
          style: 'width:140px',
          'onUpdate:value': (v: number | null) => {
            editRows.value[index].quota = Number(v || 0);
            editRows.value[index].remaining = Math.max(0, editRows.value[index].quota - row.sold);
          },
        }),
    },
    {
      title: '余票',
      key: 'remaining',
      render: (row) =>
        h(NTag, { size: 'small', bordered: false, type: row.remaining > 0 ? 'success' : 'error' }, { default: () => String(row.remaining) }),
    },
  ];

  async function loadData() {
    loading.value = true;
    try {
      const data = await getTicketList({ date: date.value || defaultDate, keyword: keyword.value.trim() });
      rows.value = (data as any).list || [];
    } catch (e: any) {
      message.error(e.message || '票额加载失败');
    } finally {
      loading.value = false;
    }
  }

  function resetFilter() {
    keyword.value = '';
    date.value = defaultDate;
    loadData();
  }

  function openEdit(row: TicketRow) {
    editing.value = row;
    editRows.value = (row.seats || []).map((s: TicketSeatItem) => ({
      type: s.type,
      capacity: s.capacity,
      sold: s.sold,
      quota: s.quota,
      remaining: s.remaining,
    }));
    showEdit.value = true;
  }

  async function saveQuota() {
    if (!editing.value) return;
    saving.value = true;
    try {
      await saveTrainQuota(editing.value.trainId, {
        date: editing.value.date,
        seats: editRows.value.map((r) => ({ type: r.type, quota: Number(r.quota) })),
      });
      message.success('票额已保存');
      showEdit.value = false;
      await loadData();
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      saving.value = false;
    }
  }

  onMounted(loadData);
</script>

<style lang="less" scoped>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }

  .flex-1 {
    flex: 1;
  }

  .ticket-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 14px;
  }

  .ticket-card {
    border: 1px solid #e8ecf2;
    border-radius: 10px;
    padding: 14px 16px;
    background: #fff;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: box-shadow 0.2s, border-color 0.2s;
  }

  .ticket-card:hover {
    border-color: #b9d4f5;
    box-shadow: 0 4px 14px rgb(27 100 196 / 8%);
  }

  .tk-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  .tk-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .tk-no {
    font-size: 18px;
    font-weight: 700;
    color: #1b64c4;
  }

  .tk-type {
    font-size: 12px;
    color: #9aa3b2;
  }

  .tk-route {
    font-size: 15px;
    font-weight: 600;
    color: #253046;
  }

  .tk-time {
    font-size: 12px;
    color: #8a93a3;
  }

  .tk-seats {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
    padding: 8px 10px;
    background: #f7f9fd;
    border-radius: 8px;
  }

  .tk-seat-row {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    font-size: 12px;
  }

  .tk-seat-row b {
    min-width: 48px;
    color: #4b5563;
  }

  .tk-metric {
    color: #8a93a3;
    white-space: nowrap;
  }

  .tk-metric i {
    font-style: normal;
    color: #253046;
    font-weight: 600;
  }

  .tk-metric i.zero {
    color: #d9363e;
  }

  .tk-foot {
    display: flex;
    align-items: center;
    gap: 18px;
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px dashed #eef1f6;
    font-size: 12px;
    color: #6b7280;
  }

  .tk-foot b.remain {
    color: #d9363e;
  }

  .edit-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .edit-head {
    display: flex;
    justify-content: space-between;
    font-weight: 600;
  }

  .muted {
    color: #9aa3b2;
    font-weight: 400;
  }

  .edit-tip {
    color: #9aa3b2;
    font-size: 12px;
  }
</style>
