// 临时测试配置：验证原生 flat config 引入 eslint-config-next 16.x 是否可行
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "prefer-const": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/display-name": "off",
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
