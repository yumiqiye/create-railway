<!--
  铁路局管理：可新建“清江铁路上海局”等单位，并给车站分配所属铁路局。
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="铁路局管理">
        铁路局用于区分线路归属，例如“清江铁路”“清江铁路上海局”。模组车站同步时可在后台为车站选择所属铁路局。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4" title="铁路局列表">
      <template #header-extra>
        <n-button type="primary" size="small" @click="openCreate">新建铁路局</n-button>
      </template>
      <n-data-table
        :columns="columns"
        :data="bureaus"
        :loading="loading"
        :pagination="false"
        :bordered="false"
        size="small"
      />
    </n-card>

    <n-modal v-model:show="editVisible" preset="card" :title="editing ? '编辑铁路局' : '新建铁路局'" style="width: 460px">
      <n-form label-placement="left" label-width="100">
        <n-form-item label="名称">
          <n-input v-model:value="form.name" maxlength="40" placeholder="如：清江铁路上海局" />
        </n-form-item>
        <n-form-item label="简称">
          <n-input v-model:value="form.shortName" maxlength="20" placeholder="如：上海局" />
        </n-form-item>
        <n-form-item label="主题色">
          <n-color-picker v-model:value="form.color" :show-alpha="false" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="form.remark" maxlength="80" placeholder="可选" />
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
  import type { DataTableColumns } from 'naive-ui';
  import {
    createRailwayBureau,
    deleteRailwayBureau,
    getRailwayBureaus,
    updateRailwayBureau,
    type RailwayBureau,
  } from '@/api/ticket';

  const message = useMessage();
  const dialog = useDialog();

  const bureaus = ref<RailwayBureau[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const editVisible = ref(false);
  const editing = ref<RailwayBureau | null>(null);

  const form = reactive({
    name: '',
    shortName: '',
    color: '#1b64c4',
    remark: '',
  });

  const columns: DataTableColumns<RailwayBureau> = [
    { title: '名称', key: 'name', width: 220 },
    { title: '简称', key: 'shortName', width: 140 },
    {
      title: '主题色',
      key: 'color',
      width: 120,
      render: (row) =>
        h('div', { style: 'display:flex;align-items:center;gap:8px' }, [
          h('span', {
            style: `display:inline-block;width:14px;height:14px;border-radius:4px;background:${row.color || '#1b64c4'}`,
          }),
          h('span', row.color || ''),
        ]),
    },
    { title: '备注', key: 'remark', ellipsis: { tooltip: true } },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (row) =>
        h('div', { style: 'display:flex;gap:6px' }, [
          h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => remove(row) }, { default: () => '删除' }),
        ]),
    },
  ];

  function load() {
    loading.value = true;
    getRailwayBureaus()
      .then((rows) => (bureaus.value = rows || []))
      .catch((e: any) => message.error(e.message || '加载失败'))
      .finally(() => (loading.value = false));
  }

  function openCreate() {
    editing.value = null;
    form.name = '';
    form.shortName = '';
    form.color = '#1b64c4';
    form.remark = '';
    editVisible.value = true;
  }

  function openEdit(row: RailwayBureau) {
    editing.value = row;
    form.name = row.name;
    form.shortName = row.shortName || row.name;
    form.color = row.color || '#1b64c4';
    form.remark = row.remark || '';
    editVisible.value = true;
  }

  function submit() {
    if (!form.name.trim()) return message.warning('请填写铁路局名称');
    saving.value = true;
    const payload = { ...form };
    const task = editing.value ? updateRailwayBureau(editing.value.id, payload) : createRailwayBureau(payload);
    task
      .then(() => {
        message.success('已保存');
        editVisible.value = false;
        load();
      })
      .catch((e: any) => message.error(e.message || '保存失败'))
      .finally(() => (saving.value = false));
  }

  function remove(row: RailwayBureau) {
    dialog.warning({
      title: '删除铁路局',
      content: `确认删除“${row.name}”？该局下的车站会自动改为默认铁路局。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => {
        deleteRailwayBureau(row.id)
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
