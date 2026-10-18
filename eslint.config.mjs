import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/drizzle/**', 'docs/**', 'apps/web/src/components/ui/**'] },
  ...tseslint.configs.recommended,
);
