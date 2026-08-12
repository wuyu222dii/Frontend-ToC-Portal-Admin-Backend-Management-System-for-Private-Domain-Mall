import { createApp } from 'vue';
import { ElTag } from 'element-plus';
import 'element-plus/es/components/tag/style/css';
import '@qingxu/ui-tokens/styles.css';

import App from './App.vue';
import './styles.css';

createApp(App).component('ElTag', ElTag).mount('#app');
