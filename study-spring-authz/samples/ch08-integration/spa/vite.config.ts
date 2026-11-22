import { defineConfig } from "vite";

// redirect_uri は http://127.0.0.1:5173/callback で IdP に登録してある。
// localhost でも開けてしまうと redirect_uri が合わなくなるので、127.0.0.1 に固定し、ポートが使用中なら起動に失敗させる。
export default defineConfig({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
});
