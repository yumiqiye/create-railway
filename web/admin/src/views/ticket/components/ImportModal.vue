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
    :title="modalTitle"
    style="width: 760px; max-width: calc(100vw - 32px)"
    :bordered="false"
  >
    <n-alert type="info" :bordered="false" style="margin-bottom: 12px">
      支持 CSV / JSON。可直接粘贴，也可以选择 .csv / .json / .txt 文件；CSV
      首行表头会自动识别。全部行先校验，再统一保存，错误会按行汇总。
    </n-alert>

    <div class="import-toolbar">
      <n-button @click="pickFile">选择文件</n-button>
      <n-button quaternary @click="fillSample">填入示例</n-button>
      <n-button quaternary @click="downloadTemplate">下载 CSV 模板</n-button>
      <input ref="fileInput" type="file" accept=".csv,.json,.txt" hidden @change="onFile" />
      <span v-if="fileName" class="file-name">{{ fileName }}</span>
    </div>

    <n-input
      v-model:value="text"
      type="textarea"
      :autosize="{ minRows: 10, maxRows: 16 }"
      :placeholder="placeholder"
      class="import-text"
    />

    <div class="import-tip">
      <template v-if="type === 'cities'">列：城市名称、拼音、城市代码；城市名称与代码不能重复。</template>
      <template v-else-if="type === 'stations'">
        列：车站名称、所属城市、电报码；所属城市可用城市名称或城市代码，电报码全局唯一。
      </template>
      <template v-else>
        列：车次号、车型、出发站、到达站、出发时刻、到达时刻、站台、检票口、地标颜色、席别配置；
        席别配置示例：<code>商务座:439:8|一等座:219.5:60|二等座:139.5:320</code>。
      </template>
    </div>

    <n-alert v-if="errorText" type="error" :bordered="false" style="margin-top: 12px">
      {{ errorText }}
    </n-alert>

    <div v-if="result" class="import-result">
      <n-alert :type="result.failed ? 'warning' : 'success'" :bordered="false">
        共 {{ result.total }} 条：成功 {{ result.imported }} 条，跳过
        {{ result.skipped }} 条，失败 {{ result.failed }} 条。
      </n-alert>
      <div v-if="result.messages.length" class="message-list">
        <div v-for="(item, index) in result.messages" :key="index" :class="item.type">
          第 {{ item.row }} 条 · {{ item.type === 'skip' ? '跳过' : '失败' }}：{{ item.message }}
        </div>
      </div>
      <div v-if="result.imported > 0 && (result.failed > 0 || result.skipped > 0)" class="result-actions">
        <n-button size="small" @click="reloadPage">关闭并刷新列表</n-button>
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
  import {
    importTicketData,
    type ImportResult,
    type ImportType,
  } from '@/api/ticket';

  const props = defineProps<{
    show: boolean;
    type: ImportType;
    title?: string;
  }>();
  const emit = defineEmits<{
    (event: 'update:show', value: boolean): void;
    (event: 'imported'): void;
  }>();

  const message = useMessage();
  const visible = computed({
    get: () => props.show,
    set: (value: boolean) => emit('update:show', value),
  });

  const fileInput = ref<HTMLInputElement | null>(null);
  const text = ref('');
  const fileName = ref('');
  const loading = ref(false);
  const errorText = ref('');
  const result = ref<ImportResult | null>(null);

  const modalTitle = computed(() => props.title || '批量导入');

  const columnsMap: Record<ImportType, string[]> = {
    cities: ['城市名称', '拼音', '城市代码'],
    stations: ['车站名称', '所属城市', '电报码'],
    trains: [
      '车次号',
      '车型',
      '出发站',
      '到达站',
      '出发时刻',
      '到达时刻',
      '站台',
      '检票口',
      '地标颜色',
      '席别配置',
    ],
  };

  const sampleRows: Record<ImportType, Record<string, string>[]> = {
    cities: [
      { 城市名称: '杭州', 拼音: 'hangzhou', 城市代码: 'HZH' },
      { 城市名称: '苏州', 拼音: 'suzhou', 城市代码: 'SZH' },
    ],
    stations: [
      { 车站名称: '杭州东', 所属城市: '杭州', 电报码: 'HDH' },
      { 车站名称: '苏州北', 所属城市: '苏州', 电报码: 'SBH' },
    ],
    trains: [
      {
        车次号: 'G7501',
        车型: '高速动车',
        出发站: '杭州东',
        到达站: '苏州北',
        出发时刻: '08:00',
        到达时刻: '09:30',
        站台: '5',
        检票口: 'B12',
        地标颜色: '蓝色',
        席别配置: '商务座:439:8|一等座:219.5:60|二等座:139.5:320',
      },
    ],
  };

  const placeholder = computed(
    () =>
      `请粘贴${props.type === 'cities' ? '城市' : props.type === 'stations' ? '车站' : '车次'}数据，例如：\n` +
      columnsMap[props.type].join(',') +
      '\n' +
      Object.values(sampleRows[props.type][0]).join(',')
  );

  watch(
    () => props.show,
    (show) => {
      if (!show) return;
      text.value = '';
      fileName.value = '';
      errorText.value = '';
      result.value = null;
      if (fileInput.value) fileInput.value.value = '';
    }
  );

  function fillSample() {
    text.value =
      columnsMap[props.type].join(',') +
      '\n' +
      sampleRows[props.type]
        .map((row) => columnsMap[props.type].map((key) => row[key] ?? '').join(','))
        .join('\n');
    result.value = null;
    errorText.value = '';
  }

  function downloadTemplate() {
    const content =
      '\ufeff' +
      columnsMap[props.type].join(',') +
      '\n' +
      sampleRows[props.type]
        .map((row) => columnsMap[props.type].map((key) => row[key] ?? '').join(','))
        .join('\n') +
      '\n';
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${
      props.type === 'cities' ? '城市' : props.type === 'stations' ? '车站' : '车次'
    }导入模板.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function pickFile() {
    fileInput.value?.click();
  }

  function reloadPage() {
    window.location.reload();
  }

  async function onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    fileName.value = file.name;
    text.value = await file.text();
    result.value = null;
    errorText.value = '';
    input.value = '';
  }

  function parseCsv(source: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    const delimiter = source.includes('\t') && !source.includes(',') ? '\t' : ',';
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '"') {
        if (inQuotes && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        row.push(field);
        field = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && source[index + 1] === '\n') index += 1;
        row.push(field);
        field = '';
        if (row.some((cell) => cell.trim() !== '')) rows.push(row);
        row = [];
      } else {
        field += char;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    }
    return rows;
  }

  function parseRows(source: string): Record<string, any>[] {
    const cleaned = source.replace(/^\ufeff/, '').trim();
    if (!cleaned) throw new Error('请先粘贴数据或选择文件');
    if (cleaned.startsWith('[') || cleaned.startsWith('{')) {
      const parsed = JSON.parse(cleaned);
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.rows) ? parsed.rows : [parsed];
      if (!rows.length) throw new Error('JSON 中没有数据');
      return rows;
    }

    const table = parseCsv(cleaned);
    if (!table.length) throw new Error('没有解析到有效数据');
    const hints = [
      ...Object.values(columnsMap).flat(),
      'name',
      'pinyin',
      'code',
      'city',
      'cityname',
      'citycode',
      'trainno',
      'type',
      'from',
      'to',
      'seats',
    ].map((item) => item.toLowerCase());
    const first = table[0].map((cell) => cell.trim().toLowerCase());
    const hasHeader = first.some((cell) => hints.includes(cell));
    const headers = hasHeader ? table[0].map((cell) => cell.trim()) : columnsMap[props.type];
    const dataRows = hasHeader ? table.slice(1) : table;
    if (!dataRows.length) throw new Error('只有表头，没有可导入的数据');
    return dataRows.map((cells) => {
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = (cells[index] ?? '').trim();
      });
      return row;
    });
  }

  async function submit() {
    loading.value = true;
    errorText.value = '';
    result.value = null;
    try {
      const rows = parseRows(text.value);
      if (rows.length > 500) throw new Error('单次最多导入 500 条，请分批导入');
      const res = await importTicketData(props.type, rows);
      result.value = res;
      if (res.imported > 0) {
        message.success(`成功导入 ${res.imported} 条`);
        if (res.failed === 0 && res.skipped === 0) {
          setTimeout(() => window.location.reload(), 1200);
        }
      } else {
        message.warning('本次没有新增数据，请查看下方逐行结果');
      }
    } catch (e: any) {
      errorText.value = e.message || '导入失败';
    } finally {
      loading.value = false;
    }
  }
</script>

<style scoped>
  .import-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .file-name {
    color: #666;
    font-size: 12px;
  }

  .import-text {
    width: 100%;
  }

  .import-tip {
    margin-top: 8px;
    color: #666;
    font-size: 12px;
    line-height: 1.7;
  }

  .import-tip code {
    color: #1b64c4;
  }

  .import-result {
    margin-top: 12px;
  }

  .message-list {
    max-height: 180px;
    margin-top: 8px;
    padding: 8px 12px;
    overflow: auto;
    font-size: 12px;
    line-height: 1.8;
    background: #f7f8fa;
    border-radius: 6px;
  }

  .message-list .error {
    color: #d03050;
  }

  .message-list .skip {
    color: #b8860b;
  }

  .result-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
  }
</style>
