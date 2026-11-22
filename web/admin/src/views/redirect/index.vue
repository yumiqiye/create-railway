<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<script lang="tsx">
  import { defineComponent, onBeforeMount } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import { NEmpty } from 'naive-ui';

  export default defineComponent({
    name: 'Redirect',
    setup() {
      const route = useRoute();
      const router = useRouter();
      onBeforeMount(() => {
        const { params, query } = route;
        const { path } = params;
        router.replace({
          path: '/' + (Array.isArray(path) ? path.join('/') : path),
          query,
        });
      });
      return () => <NEmpty />;
    },
  });
</script>
