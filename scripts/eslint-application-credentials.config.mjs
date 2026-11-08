import tseslint from 'typescript-eslint';

// The repository-wide config is currently empty. Give the new infrastructure a
// real lint check without changing lint policy for unrelated existing modules.
export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.spec.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
