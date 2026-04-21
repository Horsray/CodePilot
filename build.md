<br />
<!-- 构建前测试 -->
npm run test

<!-- 构建前清理 -->
pkill -f "next" 2>/dev/null; sleep 1; rm -rf /Users/horsray/Documents/codepilot/CodePilot/.next /Users/horsray/Documents/codepilot/CodePilot/dist-electron 2>/dev/null; echo "cleaned"

<!-- 构建electron -->
npm run electron:build

<!-- 构建electron并打包 -->
npm run electron:build && npm run electron:pack:mac -- --arm64
<!-- 构建electron并打包（mac） -->
rm -rf dist-electron && npm run electron:build && npm run electron:pack:mac -- --arm64

