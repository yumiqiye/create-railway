<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="乘车人黑名单">
        分高铁、地铁两个桶管理禁购人员。按证件号优先匹配，证件号为空时按姓名匹配；设置封禁时长后到期自动失效，留空表示长期封禁。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4">
      <div class="toolbar">
        <n-tabs v-model:value="mode" type="line" @update:value="load">
          <n-tab-pane name="highspeed" tab="高铁黑名单" />
          <n-tab-pane name="metro" tab="地铁黑名单" />
        </n-tabs>
        <n-button type="primary" size="small" @click="openCreate">加入黑名单</n-button>
      </div>

      <n-data-table
        :columns="columns"
        :data="rows"
        :loading="loading"
        :pagination="false"
        :bordered="false"
        size="small"
      />
    </n-card>

    <n-modal v-model:show="editVisible" preset="card" title="加入黑名单" style="width: 520px">
      <n-form label-placement="left" label-width="100">
        <n-form-item label="姓名">
          <n-input v-model:value="form.name" maxlength="30" placeholder="与证件号至少填写一项" />
        </n-form-item>
        <n-form-item label="证件号">
          <n-input v-model:value="form.idNo" maxlength="40" placeholder="身份证 / 乘车卡号" />
        </n-form-item>
        <n-form-item label="封禁原因">
          <n-input v-model:value="form.reason" type="textarea" :rows="2" maxlength="80" placeholder="例如：逃票、扰乱乘车秩序" />
        </n-form-item>
        <n-form-item label="封禁时长">
          <n-input-number v-model:value="minutes" :min="0" :max="43200" :precision="0" style="width: 160px">
            <template #suffix>分钟</template>
          </n-input-number>
          <span class="hint">0 表示长期封禁</span>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="editVisible = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="submit">确认加入</n-button>
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
    addBlacklist,
    getBlacklist,
    removeBlacklist,
    type BlacklistEntry,
  } from '@/api/ticket';

  type BlacklistMode = 'highspeed' | 'metro';

  const message = useMessage();
  const dialog = useDialog();

  const mode = ref<BlacklistMode>('highspeed');
  const rows = ref<BlacklistEntry[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const editVisible = ref(false);
  const minutes = ref(0);

  const form = reactive({
    name: '',
    idNo: '',
    reason: '',
  });

  function formatUntil(until: number) {
    if (!until) return '长期';
    const expired = Date.now() > until;
    const text = new Date(until).toLocaleString('zh-CN', { hour12: false });
    return expired ? `已到期 ${text}` : text;
  }

  const columns: DataTableColumns<BlacklistEntry> = [
    { title: '姓名', key: 'name', width: 140, render: (row) => row.name || '-' },
    { title: '证件号 / 卡号', key: 'idNo', width: 200, render: (row) => row.idNo || '-' },
    { title: '原因', key: 'reason', ellipsis: { tooltip: true } },
    { title: '到期时间', key: 'until', width: 210, render: (row) => formatUntil(Number(row.until)) },
    { title: '来源', key: 'source', width: 120, render: (row) => row.source || 'admin' },
    { title: '加入时间', key: 'createdAt', width: 190, render: (row) => row.createdAt || '-' },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (row) =>
        h(
          NButton,
          { size: 'small', quaternary: true, type: 'error', onClick: () => remove(row) },
          { default: () => '解除' }
        ),
    },
  ];

  async function load() {
    loading.value = true;
    try {
      const data = await getBlacklist(mode.value);
      rows.value = data?.rows || [];
    } catch (e: any) {
      message.error(e.message || '加载失败');
    } finally {
      loading.value = false;
    }
  }

  function openCreate() {
    form.name = '';
    form.idNo = '';
    form.reason = '';
    minutes.value = 0;
    editVisible.value = true;
  }

  function submit() {
    if (!form.name.trim() && !form.idNo.trim()) {
      return message.warning('姓名或证件号至少填写一项');
    }
    saving.value = true;
    addBlacklist(mode.value, { ...form, minutes: minutes.value })
      .then(() => {
        message.success('已加入黑名单');
        editVisible.value = false;
        load();
      })
      .catch((e: any) => message.error(e.message || '保存失败'))
      .finally(() => (saving.value = false));
  }

  function remove(row: BlacklistEntry) {
    dialog.warning({
      title: '解除黑名单',
      content: `确认解除“${row.name || row.idNo}”的${mode.value === 'metro' ? '地铁' : '高铁'}购票限制？`,
      positiveText: '解除',
      negativeText: '取消',
      onPositiveClick: () => {
        removeBlacklist(mode.value, row.id)
          .then(() => {
            message.success('已解除');
            load();
          })
          .catch((e: any) => message.error(e.message || '解除失败'));
      },
    });
  }

  onMounted(load);
</script>

<style scoped>
  .mt-4 {
    margin-top: 16px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .hint {
    margin-left: 10px;
    color: #8aa6c0;
    font-size: 12px;
  }
</style>
