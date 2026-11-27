<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="Create 时刻表批量导入"
    style="width: 780px; max-width: calc(100vw - 32px)"
    :bordered="false"
  >
    <n-alert type="info" :bordered="false" class="mb-4">
      按车次提交完整经停序列；已存在的车次会按车次号更新，不存在则新增。车站名称必须与后台车站库一致，经停站顺序即列车运行方向。
    </n-alert>

    <div class="import-toolbar">
      <n-button quaternary @click="fillSample">填入示例</n-button>
      <n-button quaternary @click="downloadTemplate">下载 JSON 模板</n-button>
      <span class="hint">支持粘贴 .json 文件内容；单次最多 200 条车次。</span>
    </div>

    <n-input
      v-model:value="text"
      type="textarea"
      :autosize="{ minRows: 12, maxRows: 18 }"
      placeholder='{"trains":[{"trainNo":"G7501","type":"高速动车","stops":[{"stationName":"杭州东","departTime":"08:00","km":0},{"stationName":"苏州北","arriveTime":"09:30","km":1323}]}]}'
      class="import-text"
    />

    <n-alert v-if="errorText" type="error" :bordered="false" class="mt-3">{{ errorText }}</n-alert>

    <div v-if="result" class="import-result mt-3">
      <n-alert :type="result.failed ? 'warning' : 'success'" :bordered="false">
        共 {{ result.total }} 条：成功 {{ result.imported }} 条，失败 {{ result.failed }} 条。
      </n-alert>
      <div v-if="result.messages.length" class="message-list">
        <div v-for="(item, index) in result.messages" :key="index" :class="item.type">
          第 {{ item.row }} 条 · {{ item.type === 'success' ? '成功' : '失败' }}：{{ item.message }}
        </div>
      </div>
    </div>

    <template #footer>
      <n-space justify="end">
        <n-button @click="visible = false">关闭</n-button>
        <n-button type="primary" :loading="loading" @click="submit">开始导入</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script lang="ts" setup>
  import { computed, ref, watch } from 'vue';
  import { useMessage } from 'naive-ui';
  import { importTimetable, type ImportResult, type TimetableTrainInput } from '@/api/ticket';

  const props = defineProps<{ show: boolean }>();
  const emit = defineEmits<{
    (event: 'update:show', value: boolean): void;
    (event: 'imported'): void;
  }>();

  const message = useMessage();
  const visible = computed({
    get: () => props.show,
    set: (value: boolean) => emit('update:show', value),
  });

  const text = ref('');
  const loading = ref(false);
  const errorText = ref('');
  const result = ref<ImportResult | null>(null);

  const sample: TimetableTrainInput[] = [
    {
      trainNo: 'G7501',
      type: '高速动车',
      departTime: '08:00',
      arriveTime: '09:30',
      platform: '5',
      gates: ['B12'],
      landmarkColor: '蓝色',
      seats: [
        { type: '商务座', price: 439, total: 8 },
        { type: '一等座', price: 219.5, total: 60 },
        { type: '二等座', price: 139.5, total: 320 },
      ],
      stops: [
        { stationName: '杭州东', departTime: '08:00', km: 0 },
        { stationName: '苏州北', arriveTime: '09:30', km: 1323 },
      ],
    },
  ];

  function fillSample() {
    text.value = JSON.stringify({ trains: sample }, null, 2);
    errorText.value = '';
    result.value = null;
  }

  function downloadTemplate() {
    const blob = new Blob([JSON.stringify({ trains: sample }, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Create时刻表导入模板.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  watch(
    () => props.show,
    (show) => {
      if (!show) return;
      text.value = '';
      errorText.value = '';
      result.value = null;
    }
  );

  function parsePayload(): TimetableTrainInput[] {
    const parsed = JSON.parse(text.value);
    const trains = Array.isArray(parsed) ? parsed : parsed?.trains;
    if (!Array.isArray(trains)) throw new Error('JSON 顶层应为对象，且 trains 为数组');
    return trains;
  }

  async function submit() {
    let trains: TimetableTrainInput[];
    try {
      trains = parsePayload();
    } catch (e: any) {
      errorText.value = `JSON 解析失败：${e.message || e}`;
      return;
    }
    if (!trains.length) return message.warning('请至少提交一条车次');
    loading.value = true;
    errorText.value = '';
    result.value = null;
    try {
      const data = await importTimetable(trains);
      result.value = data;
      if (data.imported > 0) emit('imported');
    } catch (e: any) {
      errorText.value = e.message || '导入失败';
    } finally {
      loading.value = false;
    }
  }
</script>

<style scoped>
  .mb-4 { margin-bottom: 16px; }
  .mt-3 { margin-top: 12px; }
  .import-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .hint { color: #8aa6c0; font-size: 12px; }
  .message-list { margin-top: 10px; max-height: 180px; overflow: auto; }
  .message-list > div { padding: 4px 0; font-size: 13px; }
  .message-list .success { color: #7ee7c3; }
  .message-list .fail { color: #ff9c9c; }
</style>
