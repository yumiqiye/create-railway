<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="车站管理">
        车站归属于城市，是车次经停与购票的实际站点。电报码为铁路系统内的车站编码（演示数据）。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4 proCard">
      <div class="toolbar">
        <n-space>
          <n-select
            v-model:value="cityFilter"
            :options="cityOptions"
            placeholder="按城市筛选"
            clearable
            style="width: 200px"
          />
          <n-input
            v-model:value="keyword"
            placeholder="搜索车站名称 / 电报码"
            clearable
            style="width: 240px"
          />
          <n-button quaternary @click="resetFilter">重置</n-button>
        </n-space>
        <n-space>
          <n-button quaternary @click="importVisible = true">批量导入</n-button>
          <n-button type="primary" @click="openCreate">
            <template #icon>
              <n-icon><PlusOutlined /></n-icon>
            </template>
            新增车站
          </n-button>
        </n-space>
      </div>

      <n-data-table
        :columns="columns"
        :data="filteredStations"
        :loading="loading"
        :row-key="(row: StationItem) => row.id"
        :pagination="pagination"
        :bordered="false"
        :single-line="false"
      />
    </n-card>

    <n-modal
      v-model:show="showModal"
      preset="card"
      :title="isEdit ? '编辑车站' : '新增车站'"
      style="width: 520px"
      :bordered="false"
    >
      <n-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-placement="left"
        label-width="90"
      >
        <n-form-item label="所属城市" path="cityId">
          <n-select v-model:value="form.cityId" :options="cityOptions" placeholder="请选择所属城市" filterable />
        </n-form-item>
        <n-form-item label="车站名称" path="name">
          <n-input v-model:value="form.name" placeholder="例如：苏州北" maxlength="20" />
        </n-form-item>
        <n-form-item label="电报码" path="code">
          <n-input v-model:value="form.code" placeholder="三字码，例如：OHH" maxlength="5" />
        </n-form-item>
        <n-form-item label="车站状态">
          <n-select v-model:value="form.status" :options="statusOptions" />
        </n-form-item>
        <n-form-item label="检票口数">
          <n-input-number v-model:value="form.gateCount" :min="0" :max="99" :precision="0" style="width: 160px" />
        </n-form-item>
        <n-form-item label="站台数">
          <n-input-number v-model:value="form.platformCount" :min="0" :max="99" :precision="0" style="width: 160px" />
        </n-form-item>
        <n-form-item label="车站地址">
          <n-input v-model:value="form.address" placeholder="可选，用于车站大屏展示" maxlength="80" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="submit">确定</n-button>
        </n-space>
      </template>
    </n-modal>

    <ImportModal v-model:show="importVisible" type="stations" title="批量导入车站" />
  </div>
</template>

<script lang="ts" setup>
  import { computed, h, onMounted, reactive, ref } from 'vue';
  import { NButton, NDropdown, NSpace, NTag, useDialog, useMessage } from 'naive-ui';
  import type { DataTableColumns, FormInst, FormRules, SelectOption } from 'naive-ui';
  import { PlusOutlined } from '@vicons/antd';
  import {
    createStation,
    deleteStation,
    getCityList,
    getStationList,
    updateStation,
    type CityItem,
    type StationItem,
  } from '@/api/ticket';
  import ImportModal from '../components/ImportModal.vue';

  const message = useMessage();
  const dialog = useDialog();

  const loading = ref(false);
  const saving = ref(false);
  const keyword = ref('');
  const cityFilter = ref<string | null>(null);
  const stations = ref<StationItem[]>([]);
  const cities = ref<CityItem[]>([]);
  const showModal = ref(false);
  const importVisible = ref(false);
  const isEdit = ref(false);
  const editingId = ref('');
  const formRef = ref<FormInst | null>(null);

  const form = reactive({
    cityId: null as string | null,
    name: '',
    code: '',
    status: 'normal' as 'normal' | 'maintenance' | 'closed',
    gateCount: 1,
    platformCount: 1,
    address: '',
  });

  const statusOptions = [
    { label: '正常运营', value: 'normal' },
    { label: '维护中', value: 'maintenance' },
    { label: '暂停使用', value: 'closed' },
  ];
  const statusMeta: Record<string, { label: string; type: 'success' | 'warning' | 'error' }> = {
    normal: { label: '正常运营', type: 'success' },
    maintenance: { label: '维护中', type: 'warning' },
    closed: { label: '暂停使用', type: 'error' },
  };

  const cityOptions = computed<SelectOption[]>(() =>
    cities.value.map((c) => ({ label: `${c.name}（${c.code}）`, value: c.id }))
  );

  const rules: FormRules = {
    cityId: [{ required: true, message: '请选择所属城市', trigger: ['blur', 'change'] }],
    name: [{ required: true, message: '请输入车站名称', trigger: ['blur', 'input'] }],
    code: [{ required: true, message: '请输入电报码', trigger: ['blur', 'input'] }],
  };

  const pagination = reactive({
    pageSize: 10,
    showSizePicker: true,
    pageSizes: [10, 20, 50],
    page: 1,
    onChange: (page: number) => {
      pagination.page = page;
    },
    onUpdatePageSize: (size: number) => {
      pagination.pageSize = size;
      pagination.page = 1;
    },
  }) as any;

  const filteredStations = computed(() => {
    const kw = keyword.value.trim().toLowerCase();
    return stations.value.filter((s) => {
      if (cityFilter.value && s.cityId !== cityFilter.value) return false;
      if (!kw) return true;
      return s.name.toLowerCase().includes(kw) || s.code.toLowerCase().includes(kw);
    });
  });

  const columns: DataTableColumns<StationItem> = [
    {
      title: '车站名称',
      key: 'name',
      width: 160,
      render: (row) =>
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [
          h('span', { style: 'font-weight:600;color:#253046' }, row.name),
          h('span', { style: 'color:#9aa3b2;font-size:12px' }, row.address || row.code),
        ]),
    },
    { title: '所属城市', key: 'cityName', width: 120 },
    { title: '电报码', key: 'code', width: 90 },
    {
      title: '车站状态',
      key: 'status',
      width: 110,
      render: (row) => {
        const meta = statusMeta[row.status || 'normal'] || statusMeta.normal;
        return h(NTag, { size: 'small', type: meta.type, bordered: false }, { default: () => meta.label });
      },
    },
    { title: '检票口数', key: 'gateCount', width: 90, render: (row) => row.gateCount ?? 0 },
    { title: '站台数', key: 'platformCount', width: 80, render: (row) => row.platformCount ?? 0 },
    { title: '关联车次', key: 'trainCount', width: 90, render: (row) => `${row.trainCount || 0} 个` },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (row) =>
        h(NSpace, { size: 6, wrap: false }, {
          default: () => [
            h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑' }),
            h(
              NDropdown,
              {
                options: [
                  { label: '查看详情', key: 'detail' },
                  { label: '删除车站', key: 'delete' },
                ],
                onSelect: (key: string) => {
                  if (key === 'delete') confirmDelete(row);
                  if (key === 'detail') openEdit(row);
                },
              },
              {
                default: () =>
                  h(NButton, { size: 'small', quaternary: true }, { default: () => '更多 ⌄' }),
              }
            ),
          ],
        }),
    },
  ];

  async function loadData() {
    loading.value = true;
    try {
      const [stationList, cityList] = await Promise.all([getStationList(), getCityList()]);
      stations.value = (stationList as StationItem[]) || [];
      cities.value = (cityList as CityItem[]) || [];
    } catch (e: any) {
      message.error(e.message || '车站列表加载失败');
    } finally {
      loading.value = false;
    }
  }

  function resetFilter() {
    keyword.value = '';
    cityFilter.value = null;
  }

  function resetForm() {
    form.cityId = null;
    form.name = '';
    form.code = '';
    form.status = 'normal';
    form.gateCount = 1;
    form.platformCount = 1;
    form.address = '';
    editingId.value = '';
    formRef.value?.restoreValidation();
  }

  async function refreshCities() {
    try {
      cities.value = ((await getCityList()) as CityItem[]) || [];
    } catch (e) {
      /* ignore */
    }
  }

  function openCreate() {
    refreshCities();
    isEdit.value = false;
    resetForm();
    showModal.value = true;
  }

  function openEdit(row: StationItem) {
    refreshCities();
    isEdit.value = true;
    editingId.value = row.id;
    form.cityId = row.cityId;
    form.name = row.name;
    form.code = row.code;
    form.status = row.status || 'normal';
    form.gateCount = row.gateCount ?? 1;
    form.platformCount = row.platformCount ?? 1;
    form.address = row.address || '';
    formRef.value?.restoreValidation();
    showModal.value = true;
  }

  function submit() {
    formRef.value?.validate(async (errors) => {
      if (errors) return;
      saving.value = true;
      const payload = {
        cityId: form.cityId,
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        status: form.status,
        gateCount: form.gateCount ?? 0,
        platformCount: form.platformCount ?? 0,
        address: form.address.trim(),
      };
      try {
        if (isEdit.value) {
          await updateStation(editingId.value, payload as any);
          message.success('车站更新成功');
        } else {
          await createStation(payload as any);
          message.success('车站新增成功');
        }
        showModal.value = false;
        await loadData();
      } catch (e: any) {
        message.error(e.message || '保存失败');
      } finally {
        saving.value = false;
      }
    });
  }

  function confirmDelete(row: StationItem) {
    dialog.warning({
      title: '删除车站',
      content: `确定删除车站「${row.name}」吗？被车次引用时需先调整车次。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await deleteStation(row.id);
          message.success('删除成功');
          await loadData();
        } catch (e: any) {
          message.error(e.message || '删除失败');
        }
      },
    });
  }

  onMounted(loadData);
</script>

<style lang="less" scoped>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
</style>
