<br />

npm run test

rm -rf dist-electron && npm run electron:build && npm run electron:pack:mac -- --arm64

npm run electron:build

npm run electron:pack:mac

npm run electron:pack:mac -- --arm64
