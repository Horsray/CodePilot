import { FlatCompat } from "@eslint/eslintrc";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  ...compat.extends("next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "prefer-const": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/display-name": "off", // Disable display-name check globally as it's too strict for memo
    },
  },
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "release/**",
      "dist-electron/**",
      "next-env.d.ts",
      "apps/site/.next/**",
      "apps/site/.source/**",
      "资料/**",
    ],
  },
];

export default eslintConfig;
