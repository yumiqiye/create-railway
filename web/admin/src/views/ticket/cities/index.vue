<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="城市管理">
        维护开通售票业务的城市。城市是前台查询的起点，新增后即可在「车站管理」中为其挂载车站。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4 proCard">
      <div class="toolbar">
        <n-input
          v-model:value="keyword"
          placeholder="搜索城市名称 / 拼音 / 城市代码"
          clearable
          style="max-width: 280px"
        />
        <n-button type="primary" @click="openCreate">
          <template #icon>
            <n-icon><PlusOutlined /></n-icon>
          </template>
          新增城市
        </n-button>
        <n-button quaternary @click="importVisible = true">批量导入</n-button>
      </div>

      <n-data-table
        :columns="columns"
        :data="filteredCities"
        :loading="loading"
        :row-key="(row: CityItem) => row.id"
        :pagination="pagination"
        :bordered="false"
        :single-line="false"
      />
    </n-card>

    <n-modal
      v-model:show="showModal"
      preset="card"
      :title="isEdit ? '编辑城市' : '新增城市'"
      style="width: 520px"
      :bordered="false"
    >
      <n-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-placement="left"
        label-width="90"
        require-mark-placement="right-hanging"
      >
        <n-form-item label="城市名称" path="name">
          <n-input v-model:value="form.name" placeholder="例如：苏州" maxlength="20" />
        </n-form-item>
        <n-form-item label="拼音" path="pinyin">
          <n-input v-model:value="form.pinyin" placeholder="例如：suzhou" maxlength="30" />
        </n-form-item>
        <n-form-item label="城市代码" path="code">
          <n-input v-model:value="form.code" placeholder="三字码，例如：SZH" maxlength="5" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="submit">确定</n-button>
        </n-space>
      </template>
    </n-modal>

    <ImportModal v-model:show="importVisible" type="cities" title="批量导入城市" />
  </div>
</template>

<script lang="ts" setup>
  import { computed, h, onMounted, reactive, ref } from 'vue';
  import { NButton, NSpace, NTag, useDialog, useMessage } from 'naive-ui';
  import type { DataTableColumns, FormInst, FormRules } from 'naive-ui';
  import { PlusOutlined } from '@vicons/antd';
  import { createCity, deleteCity, getCityList, updateCity, type CityItem } from '@/api/ticket';
  import ImportModal from '../components/ImportModal.vue';

  const message = useMessage();
  const dialog = useDialog();

  const loading = ref(false);
  const saving = ref(false);
  const keyword = ref('');
  const cities = ref<CityItem[]>([]);
  const showModal = ref(false);
  const importVisible = ref(false);
  const isEdit = ref(false);
  const editingId = ref('');
  const formRef = ref<FormInst | null>(null);

  const form = reactive({ name: '', pinyin: '', code: '' });

  const rules: FormRules = {
    name: [{ required: true, message: '请输入城市名称', trigger: ['blur', 'input'] }],
    pinyin: [
      { required: true, message: '请输入拼音', trigger: ['blur', 'input'] },
      {
        pattern: /^[a-zA-Z\s]+$/,
        message: '拼音只能包含英文字母',
        trigger: ['blur', 'input'],
      },
    ],
    code: [{ required: true, message: '请输入城市代码', trigger: ['blur', 'input'] }],
  };

  const pagination = reactive({
    pageSize: 10,
    showSizePicker: true,
    pageSizes: [10, 20, 50],
    onChange: (page: number) => {
      pagination.page = page;
    },
    onUpdatePageSize: (size: number) => {
      pagination.pageSize = size;
      pagination.page = 1;
    },
    page: 1,
  }) as any;

  const filteredCities = computed(() => {
    const kw = keyword.value.trim().toLowerCase();
    if (!kw) return cities.value;
    return cities.value.filter(
      (c) =>
        c.name.includes(kw) ||
        c.pinyin.toLowerCase().includes(kw) ||
        c.code.toLowerCase().includes(kw)
    );
  });

  const columns: DataTableColumns<CityItem> = [
    { title: '城市名称', key: 'name', width: 140 },
    { title: '拼音', key: 'pinyin', width: 160 },
    {
      title: '城市代码',
      key: 'code',
      width: 120,
      render: (row) => h(NTag, { type: 'info', size: 'small', bordered: false }, { default: () => row.code }),
    },
    {
      title: '车站数量',
      key: 'stationCount',
      width: 110,
      render: (row) => `${row.stationCount || 0} 个`,
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (row) =>
        h(NSpace, { size: 8 }, {
          default: () => [
            h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑' }),
            h(
              NButton,
              { size: 'small', quaternary: true, type: 'error', onClick: () => confirmDelete(row) },
              { default: () => '删除' }
            ),
          ],
        }),
    },
  ];

  async function loadData() {
    loading.value = true;
    try {
      cities.value = (await getCityList()) || [];
    } catch (e: any) {
      message.error(e.message || '城市列表加载失败');
    } finally {
      loading.value = false;
    }
  }

  function resetForm() {
    form.name = '';
    form.pinyin = '';
    form.code = '';
    editingId.value = '';
    formRef.value?.restoreValidation();
  }

  function openCreate() {
    isEdit.value = false;
    resetForm();
    showModal.value = true;
  }

  function openEdit(row: CityItem) {
    isEdit.value = true;
    editingId.value = row.id;
    form.name = row.name;
    form.pinyin = row.pinyin;
    form.code = row.code;
    formRef.value?.restoreValidation();
    showModal.value = true;
  }

  function submit() {
    formRef.value?.validate(async (errors) => {
      if (errors) return;
      saving.value = true;
      const payload = { name: form.name.trim(), pinyin: form.pinyin.trim(), code: form.code.trim().toUpperCase() };
      try {
        if (isEdit.value) {
          await updateCity(editingId.value, payload);
          message.success('城市更新成功');
        } else {
          await createCity(payload);
          message.success('城市新增成功');
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

  function confirmDelete(row: CityItem) {
    dialog.warning({
      title: '删除城市',
      content: `确定删除城市「${row.name}」吗？该城市下有车站时需先删除车站。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await deleteCity(row.id);
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
