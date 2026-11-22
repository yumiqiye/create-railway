<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="系统设置">
        站点名称、公告、退改签手续费、儿童票折扣、开检时间与后台账号均在这里维护，保存后实时同步到前台 / 检票端。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4" title="基础设置">
      <n-form ref="formRef" :model="form" label-placement="left" label-width="150" style="max-width: 760px">
        <n-form-item label="系统名称">
          <n-input v-model:value="form.siteName" maxlength="30" show-count placeholder="如：清江铁路12306" />
        </n-form-item>
        <n-form-item label="副标题">
          <n-input v-model:value="form.subtitle" maxlength="30" show-count placeholder="如：网上购票系统" />
        </n-form-item>
        <n-form-item label="首页公告">
          <n-input
            v-model:value="form.announcement"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-count
            placeholder="显示在前台购票页顶部的公告"
          />
        </n-form-item>
        <n-form-item label="启用公告">
          <n-switch v-model:value="form.announcementEnabled" />
        </n-form-item>
        <n-form-item label="公告展示方式">
          <n-radio-group v-model:value="form.announcementShowMode">
            <n-radio-button value="top">顶部横幅</n-radio-button>
            <n-radio-button value="modal">弹窗</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item label="启动即弹窗">
          <n-switch v-model:value="form.announcementOnStart" />
          <span class="hint">仅弹窗模式有效</span>
        </n-form-item>
        <n-form-item label="每次访问都弹窗">
          <n-switch v-model:value="form.announcementRepeat" />
          <span class="hint">关闭时同一浏览器只弹一次</span>
        </n-form-item>
        <n-form-item label="单笔订单乘客数">
          <n-input-number v-model:value="form.maxPassengersPerOrder" :min="1" :max="20" :precision="0" style="width: 160px" />
          <span class="hint">人（1~20）</span>
        </n-form-item>
        <n-form-item label="预售天数">
          <n-input-number v-model:value="form.presaleDays" :min="1" :max="90" :precision="0" style="width: 160px" />
          <span class="hint">天（1~90）</span>
        </n-form-item>
        <n-form-item label="支付超时时间">
          <n-input-number v-model:value="form.paymentTimeoutMinutes" :min="1" :max="120" :precision="0" style="width: 160px" />
          <span class="hint">分钟（1~120），超时自动取消并释放座位</span>
        </n-form-item>
        <n-form-item label="允许在线退票">
          <n-switch v-model:value="form.refundEnabled" />
        </n-form-item>
        <n-form-item label="客服电话">
          <n-input v-model:value="form.servicePhone" maxlength="20" placeholder="如：12306" style="width: 220px" />
        </n-form-item>
      </n-form>
    </n-card>

    <n-card :bordered="false" class="mt-4" title="铁路品牌（模组同步）">
      <n-form label-placement="left" label-width="150" style="max-width: 760px">
        <n-form-item label="铁路系统名称">
          <n-input v-model:value="form.systemName" maxlength="40" placeholder="如：清江铁路" />
        </n-form-item>
        <n-form-item label="LOGO 地址">
          <n-input v-model:value="form.logoUrl" maxlength="200" placeholder="http(s):// 或 /uploads/logo.png" />
          <span class="hint">售票机页头与网页端读取；留空使用默认图标</span>
        </n-form-item>
        <n-form-item label="默认铁路局">
          <n-input v-model:value="form.railwayBureau" maxlength="40" placeholder="如：清江铁路" />
        </n-form-item>
        <n-form-item label="计价单位">
          <n-select v-model:value="form.railwayCurrency" :options="currencyOptions" style="width: 220px" />
          <span class="hint">仅用于网页与命令提示；游戏内实际扣款物品在 config/hexie-railway.toml 的 currencyItem 配置</span>
        </n-form-item>
        <n-form-item label="每格票价系数">
          <n-input-number v-model:value="form.farePerBlock" :min="0.001" :max="10" :step="0.01" :precision="3" style="width: 180px" />
          <span class="hint">票价 = 车站中心点距离（格）× 系数，取整后受最低/最高限制</span>
        </n-form-item>
        <n-form-item label="最低票价">
          <n-input-number v-model:value="form.minFare" :min="0" :max="64" :precision="0" style="width: 150px">
            <template #suffix>绿宝石</template>
          </n-input-number>
        </n-form-item>
        <n-form-item label="最高票价">
          <n-input-number v-model:value="form.maxFare" :min="1" :max="999" :precision="0" style="width: 150px">
            <template #suffix>绿宝石</template>
          </n-input-number>
        </n-form-item>
        <n-form-item label="开检提前分钟">
          <n-input-number v-model:value="form.checkinMinutes" :min="1" :max="180" :precision="0" style="width: 150px">
            <template #suffix>分钟</template>
          </n-input-number>
        </n-form-item>
        <n-form-item label="模组管理令牌">
          <n-input v-model:value="form.railwayAdminToken" maxlength="80" placeholder="与 config/hexie-railway.toml 的 adminToken 一致" />
        </n-form-item>
        <n-form-item>
          <n-button type="primary" :loading="saving" @click="save">保存铁路品牌设置</n-button>
        </n-form-item>
      </n-form>
      <n-alert type="info" :bordered="false" style="max-width: 760px">
        售票机公告栏读取上面的“首页公告”；系统名称与 LOGO 同步显示在售票机页头和网页端。
      </n-alert>
    </n-card>

    <n-card :bordered="false" class="mt-4" title="闸机欢迎显示">
      <n-form label-placement="left" label-width="150" style="max-width: 760px">
        <n-form-item label="入站欢迎语">
          <n-input
            v-model:value="form.entryWelcomeText"
            type="textarea"
            :rows="2"
            maxlength="80"
            show-count
            placeholder="如：欢迎光临{station}"
          />
          <span class="hint">支持 {station} 占位符，替换为检票端设置中选择的车站</span>
        </n-form-item>
        <n-form-item label="出站欢送语">
          <n-input
            v-model:value="form.exitWelcomeText"
            type="textarea"
            :rows="2"
            maxlength="80"
            show-count
            placeholder="如：欢迎您再次乘坐清江铁路12306"
          />
        </n-form-item>
        <n-form-item>
          <n-button type="primary" :loading="saving" @click="save">保存闸机显示设置</n-button>
        </n-form-item>
      </n-form>
      <n-alert type="info" :bordered="false" style="max-width: 760px">
        检票端每 10 秒自动读取这里的文字；车站由每台闸机在检票端右上角设置中选择，入站欢迎语中的 {station} 会自动替换为该站名称。
      </n-alert>
    </n-card>

    <n-card :bordered="false" class="mt-4" title="版权与备案">
      <n-form label-placement="left" label-width="150" style="max-width: 860px">
        <n-form-item label="版权信息">
          <n-input v-model:value="form.footerCopyright" maxlength="60" placeholder="© 2026 清江铁路" />
        </n-form-item>
        <n-form-item label="ICP备案号">
          <n-input v-model:value="form.footerIcp" maxlength="60" placeholder="如：苏ICP备2026000001号" />
        </n-form-item>
        <n-form-item label="公安备案文字">
          <n-input v-model:value="form.footerPolice" maxlength="60" placeholder="如：公安备案" />
        </n-form-item>
        <n-form-item label="公安备案编号">
          <n-input v-model:value="form.footerPoliceNo" maxlength="60" placeholder="如：苏公网安备32010000000001号" />
        </n-form-item>
        <n-form-item>
          <n-button type="primary" :loading="saving" @click="save">保存版权与备案</n-button>
        </n-form-item>
      </n-form>
      <n-alert type="info" :bordered="false" style="max-width: 860px">
        前台、检票端底部统一展示：第一行版权信息，第二行 ICP 备案号与公安备案号。
      </n-alert>
    </n-card>

    <n-card :bordered="false" class="mt-4" title="检票终端">
      <n-form label-placement="left" label-width="150" style="max-width: 860px">
        <n-form-item label="默认维修文案">
          <n-input v-model:value="form.maintenanceText" maxlength="80" placeholder="此闸机正在维修，请使用其他闸机" />
        </n-form-item>
        <n-form-item label="显示扫码画面">
          <n-switch v-model:value="form.showScanPreview" />
          <span class="hint">默认隐藏；开启后检票端右下角显示扫码小窗</span>
        </n-form-item>
        <n-form-item label="二维码刷新间隔">
          <n-input-number v-model:value="form.ticketQrRefreshSeconds" :min="10" :max="180" :precision="0" style="width: 160px">
            <template #suffix>秒</template>
          </n-input-number>
        </n-form-item>
        <n-form-item>
          <n-button type="primary" :loading="saving" @click="save">保存检票终端设置</n-button>
        </n-form-item>
      </n-form>
      <n-alert type="info" :bordered="false" style="max-width: 860px">
        开检提前时间已移到「检票管理」中维护；单台检票机的停用与维修状态可在「检票管理 → 检票设备」中设置。
      </n-alert>
    </n-card>

    <n-card :bordered="false" class="mt-4" title="退改签与儿童票">
      <n-form label-placement="left" label-width="150" style="max-width: 860px">
        <n-form-item label="退票手续费规则">
          <div class="rule-editor">
            <div class="rule-head">
              <span>距发车小时数（≥）</span>
              <span>手续费比例</span>
              <span></span>
            </div>
            <div v-for="(rule, index) in ruleRows" :key="index" class="rule-item">
              <div class="rule-row">
                <n-input-number v-model:value="rule.hoursBefore" :min="0" :max="240" :precision="0" />
                <n-input-number v-model:value="rule.percent" :min="0" :max="100" :precision="1">
                  <template #suffix>%</template>
                </n-input-number>
                <n-button quaternary type="error" :disabled="ruleRows.length <= 1" @click="removeRule(index)">删除</n-button>
              </div>
              <span class="rule-example">发车前 ≥ {{ rule.hoursBefore || 0 }} 小时退票，扣 {{ rule.percent || 0 }}%</span>
            </div>
            <n-button dashed block @click="addRule" :disabled="ruleRows.length >= 6">+ 添加规则</n-button>
            <p class="hint block">按「距发车小时数」从大到小匹配，命中第一条即适用；未命中时使用最后一条。</p>
          </div>
        </n-form-item>
        <n-form-item label="改签手续费">
          <n-input-number v-model:value="changeFeePercent" :min="0" :max="100" :precision="1" style="width: 160px">
            <template #suffix>%</template>
          </n-input-number>
          <span class="hint">按票价正差额收取</span>
        </n-form-item>
        <n-form-item label="儿童票折扣">
          <n-input-number v-model:value="childPercent" :min="1" :max="100" :precision="0" style="width: 160px">
            <template #suffix>%</template>
          </n-input-number>
          <span class="hint">成人票价的百分比，默认 50%（半价）</span>
        </n-form-item>
        <n-form-item>
          <n-space>
            <n-button type="primary" :loading="saving" @click="save">保存设置</n-button>
            <n-button quaternary :loading="loading" @click="load">重新加载</n-button>
          </n-space>
        </n-form-item>
      </n-form>
      <n-alert type="info" :bordered="false" style="max-width: 860px">
        手续费规则与儿童票折扣会同时用于前台购票、退票、改签与后台代客购票；所有写操作原子落盘，多人同时保存不会产生半截数据。
      </n-alert>
    </n-card>

    <n-card :bordered="false" class="mt-4" title="后台账号管理">
      <template #header-extra>
        <n-button type="primary" size="small" @click="openAccountModal">
          <template #icon><n-icon><PlusOutlined /></n-icon></template>
          新增账号
        </n-button>
      </template>
      <n-data-table
        :columns="accountColumns"
        :data="accounts"
        :loading="accountLoading"
        :row-key="(row: AccountItem) => row.id"
        :pagination="false"
        :bordered="false"
        :single-line="false"
      />
      <p class="hint block">默认账号：admin / operator / inspector，初始密码均为 123456；管理员账号至少保留一个，不能全部删除。</p>
    </n-card>

    <n-card :bordered="false" class="mt-4" title="数据重置">
      <n-alert type="warning" :bordered="false" style="max-width: 860px">
        重置会清空全部演示订单、乘车人、账号与检票数据，并恢复初始演示账号，当前登录会失效。操作前必须输入管理员密码。
      </n-alert>
      <div style="margin-top: 14px">
        <n-button type="error" ghost @click="resetModal = true">重置演示数据</n-button>
      </div>
    </n-card>

    <n-modal v-model:show="resetModal" preset="card" title="重置演示数据" style="width: 440px">
      <n-form label-placement="left" label-width="90">
        <n-form-item label="管理员密码">
          <n-input v-model:value="resetPassword" type="password" placeholder="请输入当前管理员账号密码" />
        </n-form-item>
      </n-form>
      <n-alert type="warning" :bordered="false" style="margin-top: 10px">
        此操作不可撤销，重置后需要重新登录。
      </n-alert>
      <template #footer>
        <n-space justify="end">
          <n-button @click="resetModal = false">取消</n-button>
          <n-button type="error" :loading="resetLoading" @click="submitReset">确认重置</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="accountModal" preset="card" title="新增后台账号" style="width: 460px">
      <n-form ref="accountFormRef" :model="accountForm" :rules="accountRules" label-placement="left" label-width="80">
        <n-form-item label="用户名" path="username">
          <n-input v-model:value="accountForm.username" placeholder="3~20 位字母、数字或下划线" maxlength="20" />
        </n-form-item>
        <n-form-item label="姓名" path="name">
          <n-input v-model:value="accountForm.name" placeholder="显示名称" maxlength="20" />
        </n-form-item>
        <n-form-item label="角色" path="role">
          <n-select v-model:value="accountForm.role" :options="roleOptions" />
        </n-form-item>
        <n-form-item label="手机号">
          <n-input v-model:value="accountForm.phone" placeholder="可选" maxlength="11" />
        </n-form-item>
        <n-form-item label="初始密码" path="password">
          <n-input v-model:value="accountForm.password" type="password" placeholder="至少 6 位" maxlength="32" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="accountModal = false">取消</n-button>
          <n-button type="primary" :loading="accountSaving" @click="submitAccount">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="passwordModal" preset="card" title="修改密码" style="width: 420px">
      <n-form label-placement="left" label-width="90">
        <n-form-item label="账号">
          <span>{{ passwordTarget?.username }}（{{ passwordTarget?.name }}）</span>
        </n-form-item>
        <n-form-item label="新密码">
          <n-input v-model:value="newPassword" type="password" placeholder="至少 6 位" maxlength="32" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="passwordModal = false">取消</n-button>
          <n-button type="primary" :loading="passwordSaving" @click="submitPassword">确认修改</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script lang="ts" setup>
  import { h, onMounted, reactive, ref } from 'vue';
  import { NButton, NSpace, NTag, useDialog, useMessage } from 'naive-ui';
  import type { DataTableColumns, FormInst, FormRules } from 'naive-ui';
  import { PlusOutlined } from '@vicons/antd';
  import {
    createAccount,
    deleteAccount,
    getAccountList,
    getSettings,
    resetDemoData,
    updateAccountPassword,
    updateSettings,
    type AccountItem,
    type SettingsItem,
  } from '@/api/ticket';

  const message = useMessage();
  const dialog = useDialog();
  const loading = ref(false);
  const saving = ref(false);
  const formRef = ref<FormInst | null>(null);
  const currencyOptions = [
    { label: '绿宝石（emerald）', value: 'emerald' },
    { label: '钻石（diamond）', value: 'diamond' },
    { label: '金锭（gold_ingot）', value: 'gold_ingot' },
    { label: '铁锭（iron_ingot）', value: 'iron_ingot' },
  ];

  const form = reactive<SettingsItem>({
    siteName: '清江铁路12306',
    subtitle: '网上购票系统',
    announcement: '',
    maxPassengersPerOrder: 5,
    presaleDays: 30,
    paymentTimeoutMinutes: 15,
    refundEnabled: true,
    servicePhone: '12306',
    refundRules: [],
    changeFeeRate: 0.05,
    childDiscount: 0.5,
    checkinMinutes: 30,
    entryWelcomeText: '欢迎光临{station}',
    exitWelcomeText: '欢迎您再次乘坐清江铁路12306',
    announcementEnabled: true,
    announcementShowMode: 'top' as 'top' | 'modal',
    announcementOnStart: true,
    announcementRepeat: false,
    footerCopyright: '© 2026 清江铁路',
    footerIcp: '',
    footerPolice: '',
    footerPoliceNo: '',
    maintenanceText: '此闸机正在维修，请使用其他闸机',
    liveDetection: true,
    showScanPreview: false,
    ticketQrRefreshSeconds: 30,
    systemName: '清江铁路',
    logoUrl: '',
    railwayBureau: '清江铁路',
    railwayCurrency: 'emerald',
    farePerBlock: 0.02,
    minFare: 1,
    maxFare: 64,
    railwayAdminToken: 'qingjiang-railway-mod',
  });

  const resetModal = ref(false);
  const resetPassword = ref('');
  const resetLoading = ref(false);

  const ruleRows = ref<Array<{ hoursBefore: number | null; percent: number | null }>>([]);
  const changeFeePercent = ref(5);
  const childPercent = ref(50);

  function rulesToRows(rules: Array<{ hoursBefore?: number; feeRate?: number; hours?: number; rate?: number }>) {
    ruleRows.value = (rules || []).map((r) => ({
      hoursBefore: Number(r.hoursBefore ?? r.hours ?? 0),
      percent: Number(((r.feeRate ?? r.rate ?? 0) * 100).toFixed(2)),
    }));
    if (!ruleRows.value.length) {
      ruleRows.value = [
        { hoursBefore: 24, percent: 5 },
        { hoursBefore: 2, percent: 10 },
        { hoursBefore: 0, percent: 20 },
      ];
    }
  }

  async function load() {
    loading.value = true;
    try {
      const data = (await getSettings()) as SettingsItem;
      Object.assign(form, data);
      rulesToRows(data.refundRules || []);
      changeFeePercent.value = Number(((data.changeFeeRate || 0) * 100).toFixed(2));
      childPercent.value = Number(((data.childDiscount || 0.5) * 100).toFixed(0));
    } catch (e: any) {
      message.error(e.message || '设置加载失败');
    } finally {
      loading.value = false;
    }
  }

  function addRule() {
    ruleRows.value.push({ hoursBefore: 0, percent: 0 });
  }

  function removeRule(index: number) {
    ruleRows.value.splice(index, 1);
  }

  async function save() {
    if (!ruleRows.value.length) return message.error('至少保留一条退票手续费规则');
    for (const rule of ruleRows.value) {
      if (rule.hoursBefore === null || rule.percent === null) return message.error('请完整填写退票规则');
    }
    saving.value = true;
    try {
      const payload = {
        ...form,
        refundRules: ruleRows.value
          .slice()
          .sort((a, b) => Number(b.hoursBefore) - Number(a.hoursBefore))
          .map((r) => ({ hoursBefore: Number(r.hoursBefore), feeRate: Number(r.percent) / 100 })),
        changeFeeRate: Number(changeFeePercent.value) / 100,
        childDiscount: Number(childPercent.value) / 100,
      };
      const data = (await updateSettings(payload)) as SettingsItem;
      Object.assign(form, data);
      rulesToRows(data.refundRules || []);
      changeFeePercent.value = Number(((data.changeFeeRate || 0) * 100).toFixed(2));
      childPercent.value = Number(((data.childDiscount || 0.5) * 100).toFixed(0));
      message.success('设置已保存');
    } catch (e: any) {
      message.error(e.message || '保存失败');
    } finally {
      saving.value = false;
    }
  }

  async function submitReset() {
    if (!resetPassword.value) return message.warning('请输入管理员密码');
    resetLoading.value = true;
    try {
      await resetDemoData(resetPassword.value);
      message.success('数据已重置，请重新登录');
      resetModal.value = false;
      resetPassword.value = '';
      localStorage.clear();
      window.location.reload();
    } catch (e: any) {
      message.error(e.message || '重置失败');
    } finally {
      resetLoading.value = false;
    }
  }

  /* ---------------- 账号管理 ---------------- */
  const accounts = ref<AccountItem[]>([]);
  const accountLoading = ref(false);
  const accountModal = ref(false);
  const accountSaving = ref(false);
  const accountFormRef = ref<FormInst | null>(null);
  const passwordModal = ref(false);
  const passwordSaving = ref(false);
  const passwordTarget = ref<AccountItem | null>(null);
  const newPassword = ref('');

  const roleOptions = [
    { label: '管理员', value: 'admin' },
    { label: '购票员', value: 'operator' },
    { label: '检票员', value: 'inspector' },
  ];

  const roleText: Record<string, string> = { admin: '管理员', operator: '购票员', inspector: '检票员' };

  const accountForm = reactive({
    username: '',
    name: '',
    role: 'operator',
    phone: '',
    password: '',
  });

  const accountRules: FormRules = {
    username: [
      { required: true, message: '请输入用户名', trigger: ['blur', 'input'] },
      { pattern: /^[A-Za-z0-9_]{3,20}$/, message: '3~20 位字母、数字或下划线', trigger: ['blur', 'input'] },
    ],
    name: [{ required: true, message: '请输入姓名', trigger: ['blur', 'input'] }],
    role: [{ required: true, message: '请选择角色', trigger: ['blur', 'change'] }],
    password: [
      { required: true, message: '请输入初始密码', trigger: ['blur', 'input'] },
      { min: 6, message: '密码至少 6 位', trigger: ['blur', 'input'] },
    ],
  };

  const accountColumns: DataTableColumns<AccountItem> = [
    {
      title: '用户名',
      key: 'username',
      width: 110,
      render: (row) => h('span', { style: 'font-weight:600;color:#1b64c4' }, row.username),
    },
    { title: '姓名', key: 'name', width: 90 },
    {
      title: '角色',
      key: 'role',
      width: 100,
      render: (row) =>
        h(NTag, { size: 'small', type: row.role === 'admin' ? 'success' : row.role === 'inspector' ? 'warning' : 'info' }, {
          default: () => roleText[row.role] || row.role,
        }),
    },
    {
      title: '状态',
      key: 'enabled',
      width: 70,
      render: (row) =>
        h(NTag, { size: 'small', type: row.enabled ? 'success' : 'default', bordered: false }, {
          default: () => (row.enabled ? '启用' : '停用'),
        }),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (row) =>
        h(NSpace, { size: 2, wrap: false }, {
          default: () => [
            h(
              NButton,
              { size: 'tiny', quaternary: true, type: 'primary', onClick: () => openPasswordModal(row) },
              { default: () => '改密码' }
            ),
            h(
              NButton,
              { size: 'tiny', quaternary: true, type: 'error', onClick: () => confirmDeleteAccount(row) },
              { default: () => '删除' }
            ),
          ],
        }),
    },
  ];

  async function loadAccounts() {
    accountLoading.value = true;
    try {
      accounts.value = ((await getAccountList()) as AccountItem[]) || [];
    } catch (e: any) {
      message.error(e.message || '账号列表加载失败');
    } finally {
      accountLoading.value = false;
    }
  }

  function openAccountModal() {
    accountForm.username = '';
    accountForm.name = '';
    accountForm.role = 'operator';
    accountForm.phone = '';
    accountForm.password = '';
    accountModal.value = true;
  }

  function submitAccount() {
    accountFormRef.value?.validate(async (errors) => {
      if (errors) return;
      accountSaving.value = true;
      try {
        await createAccount({
          username: accountForm.username.trim(),
          name: accountForm.name.trim(),
          role: accountForm.role,
          phone: accountForm.phone.trim(),
          password: accountForm.password,
        });
        message.success('账号已新增');
        accountModal.value = false;
        await loadAccounts();
      } catch (e: any) {
        message.error(e.message || '新增失败');
      } finally {
        accountSaving.value = false;
      }
    });
  }

  function openPasswordModal(row: AccountItem) {
    passwordTarget.value = row;
    newPassword.value = '';
    passwordModal.value = true;
  }

  async function submitPassword() {
    if (!passwordTarget.value) return;
    if (newPassword.value.length < 6) return message.error('密码至少 6 位');
    passwordSaving.value = true;
    try {
      await updateAccountPassword(passwordTarget.value.id, newPassword.value);
      message.success('密码已修改，该账号下次登录需使用新密码');
      passwordModal.value = false;
    } catch (e: any) {
      message.error(e.message || '修改失败');
    } finally {
      passwordSaving.value = false;
    }
  }

  function confirmDeleteAccount(row: AccountItem) {
    dialog.warning({
      title: '删除账号',
      content: `确定删除账号「${row.username}」吗？管理员账号至少需要保留一个。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await deleteAccount(row.id);
          message.success('账号已删除');
          await loadAccounts();
        } catch (e: any) {
          message.error(e.message || '删除失败');
        }
      },
    });
  }

  onMounted(() => {
    load();
    loadAccounts();
  });
</script>

<style lang="less" scoped>
  .hint {
    margin-left: 8px;
    color: #9aa3b2;
    font-size: 12px;
  }

  .hint.block {
    display: block;
    margin-left: 0;
    margin-top: 8px;
  }

  .rule-editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    max-width: 620px;
  }

  .rule-head {
    display: grid;
    grid-template-columns: minmax(100px, 1fr) minmax(100px, 1fr) 64px;
    gap: 10px;
    font-size: 13px;
    color: #6b7280;
    padding-left: 2px;
  }

  .rule-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .rule-row {
    display: grid;
    grid-template-columns: minmax(100px, 1fr) minmax(100px, 1fr) 64px;
    gap: 10px;
    align-items: center;
  }

  .rule-example {
    font-size: 12px;
    color: #8a93a3;
    padding-left: 2px;
  }
</style>
