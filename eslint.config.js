import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'dist-*', '.tmp*', 'node_modules', 'public/data', 'playwright-report', 'test-results', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    // 脚本与 Node 侧工具：允许 Node 全局变量（含 ESM 脚本）。
    files: ['scripts/**/*.{ts,mjs,js}', 'tests/**/*.ts', '*.config.{ts,js}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // 领域层必须是纯逻辑：禁止 React 与浏览器 API。
    // 注意允许 Date.parse：解析显式 ISO 字符串是确定性的；
    // 真正需要禁止的是读取"当前时间"（new Date() / Date.now()），
    // 那会让评分结果依赖调用时刻。
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['react', 'react-dom', 'react-router-dom', '../app/*', '../pages/*', '../components/*'] },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'fetch'],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: '领域层不得读取当前时间：请把 now 由调用方传入。',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: '领域层不得读取当前时间：请把 now 由调用方传入。',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: '领域层必须保持确定性：不得使用随机数。',
        },
      ],
    },
  },
);
