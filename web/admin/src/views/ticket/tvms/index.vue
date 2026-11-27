<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="购票机台账">
        维护游戏内售票机 / 购票机设备档案：所属车站、设备名称、类型、运行状态与方块坐标。设备状态改为停用后，对应机器不再接受售票操作。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4">
      <template #header-extra>
        <n-button type="primary" size="small" @click="openCreate">新增购票机</n-button>
      </template>
      <n-data-table
        :columns="columns"
        :data="rows"
        :loading="loading"
        :pagination="false"
        :bordered="false"
        size="small"
      />
    </n-card>

    <n-modal v-model:show="editVisible" preset="card" :title="editing ? '编辑购票机' : '新增购票机'" style="width: 520px">
      <n-form label-placement="left" label-width="100">
        <n-form-item label="所属车站">
          <n-select v-model:value="form.stationId" :options="stationOptions" filterable placeholder="请选择车站" />
        </n-form-item>
        <n-form-item label="设备名称">
          <n-input v-model:value="form.name" maxlength="30" placeholder="例如：南京南 1 号购票机" />
        </n-form-item>
        <n-form-item label="设备类型">
          <n-select v-model:value="form.kind" :options="kindOptions" />
        </n-form-item>
        <n-form-item label="运行状态">
          <n-select v-model:value="form.status" :options="statusOptions" />
        </n-form-item>
        <n-form-item label="方块坐标">
          <n-input v-model:value="posText" placeholder="x,y,z，例如 8,-55,8" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="editVisible = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="submit">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script lang="ts" setup>
  import { h, onMounted, reactive, ref } from 'vue';
  import { NButton, useDialog, useMessage } from 'naive-ui';
  import type { DataTableColumns, SelectOption } from 'naive-ui';
  import {
    createRailwayTvm,
    deleteRailwayTvm,
    getRailwayTvms,
    getStationList,
    updateRailwayTvm,
    type RailwayTvm,
    type StationItem,
  } from '@/api/ticket';

  const message = useMessage();
  const dialog = useDialog();

  const rows = ref<RailwayTvm[]>([]);
  const stations = ref<StationItem[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const editVisible = ref(false);
  const editing = ref<RailwayTvm | null>(null);
  const posText = ref('');

  const kindOptions: SelectOption[] = [
    { label: '售票机', value: 'ticket-machine' },
    { label: '自助购票机', value: 'tvm' },
  ];
  const statusOptions: SelectOption[] = [
    { label: '正常', value: 'normal' },
    { label: '停用', value: 'disabled' },
  ];

  type TvmKind = 'ticket-machine' | 'tvm';
  type TvmStatus = 'normal' | 'disabled';
  const form = reactive<{ stationId: string; name: string; kind: TvmKind; status: TvmStatus }>({
    stationId: '',
    name: '',
    kind: 'ticket-machine',
    status: 'normal',
  });

  const stationOptions = ref<SelectOption[]>([]);

  function syncStationOptions() {
    stationOptions.value = stations.value.map((station) => ({
      label: station.name,
      value: station.id,
    }));
  }

  function posTextOf(pos: any) {
    if (!pos || typeof pos !== 'object') return '-';
    return [pos.x, pos.y, pos.z].map((v) => (v == null || v === '' ? '-' : v)).join(', ');
  }

  function parsePos(): { x: number; y: number; z: number } | null {
    const text = posText.value.trim();
    if (!text) return null;
    const parts = text.split(/[,，\s]+/).filter(Boolean);
    if (parts.length !== 3) throw new Error('坐标格式应为 x,y,z');
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) throw new Error('坐标必须为数字');
    return { x: nums[0], y: nums[1], z: nums[2] };
  }

  const columns: DataTableColumns<RailwayTvm> = [
    { title: '设备名称', key: 'name', width: 220 },
    { title: '所属车站', key: 'stationName', width: 160 },
    {
      title: '类型',
      key: 'kind',
      width: 130,
      render: (row) => (row.kind === 'tvm' ? '自助购票机' : '售票机'),
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (row) =>
        h(
          'n-tag',
          { type: row.status === 'disabled' ? 'error' : 'success', size: 'small', bordered: false },
          { default: () => (row.status === 'disabled' ? '停用' : '正常') }
        ),
    },
    { title: '坐标', key: 'pos', width: 180, render: (row) => posTextOf(row.pos) },
    { title: '登记时间', key: 'createdAt', width: 190, render: (row) => row.createdAt || '-' },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (row) =>
        h('div', { style: 'display:flex;gap:6px' }, [
          h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(
            NButton,
            { size: 'small', quaternary: true, type: 'error', onClick: () => remove(row) },
            { default: () => '删除' }
          ),
        ]),
    },
  ];

  async function load() {
    loading.value = true;
    try {
      const [tvmRows, stationRows] = await Promise.all([getRailwayTvms(), getStationList()]);
      rows.value = tvmRows || [];
      stations.value = stationRows || [];
      syncStationOptions();
    } catch (e: any) {
      message.error(e.message || '加载失败');
    } finally {
      loading.value = false;
    }
  }

  function openCreate() {
    editing.value = null;
    form.stationId = stations.value[0]?.id || '';
    form.name = '';
    form.kind = 'ticket-machine';
    form.status = 'normal';
    posText.value = '';
    editVisible.value = true;
  }

  function openEdit(row: RailwayTvm) {
    editing.value = row;
    form.stationId = row.stationId;
    form.name = row.name || '';
    form.kind = row.kind === 'tvm' ? 'tvm' : 'ticket-machine';
    form.status = row.status === 'disabled' ? 'disabled' : 'normal';
    posText.value = row.pos ? `${row.pos.x},${row.pos.y},${row.pos.z}` : '';
    editVisible.value = true;
  }

  function submit() {
    if (!form.stationId) return message.warning('请选择所属车站');
    let pos: any = null;
    try {
      pos = parsePos();
    } catch (e: any) {
      return message.warning(e.message || '坐标格式不正确');
    }
    saving.value = true;
    const payload = { ...form, pos };
    const task = editing.value
      ? updateRailwayTvm(editing.value.id, payload)
      : createRailwayTvm(payload);
    task
      .then(() => {
        message.success('已保存');
        editVisible.value = false;
        load();
      })
      .catch((e: any) => message.error(e.message || '保存失败'))
      .finally(() => (saving.value = false));
  }

  function remove(row: RailwayTvm) {
    dialog.warning({
      title: '删除购票机',
      content: `确认删除“${row.name || row.id}”？删除后设备档案将不再同步到游戏内。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => {
        deleteRailwayTvm(row.id)
          .then(() => {
            message.success('已删除');
            load();
          })
          .catch((e: any) => message.error(e.message || '删除失败'));
      },
    });
  }

  onMounted(load);
</script>

<style scoped>
  .mt-4 {
    margin-top: 16px;
  }
</style>
